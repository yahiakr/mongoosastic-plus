import { Model } from 'mongoose'
import { isEmpty } from 'lodash'
import { DeleteByIdOptions, EsSearchOptions, GeneratedMapping, HydratedSearchResults, PluginDocument } from 'types'
import { ApiResponse } from '@elastic/elasticsearch'
import { Property, PropertyName, SearchResponse, TotalHits } from '@elastic/elasticsearch/api/types'


export function isString(subject: unknown): boolean {
	return typeof subject === 'string'
}

export function isStringArray(arr: Array<unknown>): boolean {
	return arr.filter && arr.length === (arr.filter((item: unknown) => typeof item === 'string')).length
}

export function getIndexName(doc: PluginDocument | Model<PluginDocument>): string {
	const options = doc.esOptions()
	const indexName = options && options.index
	if (!indexName) return doc.collection.name
	else return indexName
}

export function filterMappingFromMixed(props: Record<PropertyName, Property>): Record<PropertyName, Property> {
	const filteredMapping: Record<PropertyName, Property> = {}
	Object.keys(props).map((key) => {
		const field = props[key]
		if (field.type !== 'mixed') {
			filteredMapping[key] = field
			if (field.properties) {
				filteredMapping[key].properties = filterMappingFromMixed(field.properties)
				if (isEmpty(filteredMapping[key].properties)) {
					delete filteredMapping[key].properties
				}
			}
		}
	})
	return filteredMapping
}

export function serialize(model: PluginDocument, mapping: GeneratedMapping): Record<string, unknown> | Record<string, unknown>[] | string {
	let name

	function _serializeObject(object: PluginDocument, mappingData: GeneratedMapping) {
		const serialized: Record<string, unknown> = {}
		let field
		let val
		for (field in mappingData.properties) {
			if (mappingData.properties?.hasOwnProperty(field)) {
				val = serialize.call(object, object[field as keyof PluginDocument], mappingData.properties[field])
				if (val !== undefined) {
					serialized[field] = val
				}
			}
		}
		return serialized
	}

	if (mapping.properties && model) {
		if (Array.isArray(model)) {
			return model.map(object => _serializeObject(object, mapping))
		}

		return _serializeObject(model, mapping)
	}

	const outModel = mapping.cast ? mapping.cast(model) : model
	if (typeof outModel === 'object' && outModel !== null) {
		name = outModel.constructor.name
		if (name === 'ObjectID') {
			return outModel.toString()
		}

		if (name === 'Date') {
			return new Date(outModel).toJSON()
		}
	}

	return outModel
}

export function deleteById(opt: DeleteByIdOptions, cb?: CallableFunction): void {

	const doc = opt.document

	opt.client.delete({
		index: opt.index,
		id: opt.id,
	}, {}, (err, res) => {
		if (err) {
			if (opt.tries <= 0) {
				doc.emit('es-removed', err, res)
				if (cb) return cb(err)
			}
			opt.tries = --opt.tries
			setTimeout(() => {
				deleteById(opt, cb)
			}, 500)
		} else {
			doc.emit('es-removed', err, res)
			if (cb) cb(err)
		}
	})
}

export function reformatESTotalNumber<T = unknown>(res: ApiResponse<SearchResponse<T>>): ApiResponse<SearchResponse<T>> {
	Object.assign(res.body.hits, {
		total: (res.body.hits.total as TotalHits).value,
		extTotal: res.body.hits.total
	})
	return res
}

export function hydrate(res: ApiResponse<SearchResponse>, model: Model<PluginDocument>, opts: EsSearchOptions, cb: CallableFunction): void {

	const options = model.esOptions()
	
	const clonedRes = res as ApiResponse<HydratedSearchResults>
	const results = clonedRes.body.hits

	const resultsMap: Record<string, number> = {}

	const ids = results.hits.map((result, idx) => {
		resultsMap[result._id] = idx
		return result._id
	})

	const query = model.find({
		_id: {
			$in: ids
		}
	})
	const hydrateOptions = opts.hydrateOptions ? opts.hydrateOptions : options.hydrateOptions ? options.hydrateOptions : {}

	// Build Mongoose query based on hydrate options
	// Example: {lean: true, sort: '-name', select: 'address name'}
	query.setOptions(hydrateOptions)

	query.exec((err, docs) => {
		let hits
		const docsMap: Record<string, PluginDocument> = {}

		if (err) {
			return cb(err)
		}

		if (!docs || docs.length === 0) {
			results.hits = []
			results.hydrated = []
			res.body.hits = results
			return cb(null, res)
		}

		if (hydrateOptions && hydrateOptions.sort) {
			// Hydrate sort has precedence over ES result order
			hits = docs
		} else {
			// Preserve ES result ordering
			docs.forEach(doc => {
				docsMap[doc._id] = doc
			})
			hits = results.hits.map((result) => docsMap[result._id])
		}

		if (opts.highlight || opts.hydrateWithESResults) {
			hits.forEach((doc) => {
				const idx = resultsMap[doc._id]
				if (opts.highlight) {
					doc._highlight = results.hits[idx].highlight
				}
				if (opts.hydrateWithESResults) {
					// Add to doc ES raw result (with, e.g., _score value)
					doc._esResult = results.hits[idx]
					if (!opts.hydrateWithESResults.source) {
						// Remove heavy load
						delete doc._esResult._source
					}
				}
			})
		}

		results.hits = []
		results.hydrated = hits
		res.body.hits = results
		cb(null, res)
	})
}