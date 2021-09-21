'use strict'

import { Client } from '@elastic/elasticsearch'
import { toInteger } from 'lodash'
import { Model } from 'mongoose'
import { PluginDocument } from 'types'

const esClient = new Client({ node: 'http://localhost:9200' })

const INDEXING_TIMEOUT: number = toInteger(process.env.INDEXING_TIMEOUT) || 2000
const BULK_ACTION_TIMEOUT: number = toInteger(process.env.BULK_ACTION_TIMEOUT) || 4000

async function deleteIndexIfExists(indexes: Array<string>): Promise<void> {
	for (const index of indexes) {
		const { body } = await esClient.indices.exists({ index: index })
		if(body) await esClient.indices.delete({ index: index })
	}
}

async function deleteDocs(models: Array<Model<PluginDocument>>): Promise<void> {
	for (const model of models) {
		await model.deleteMany()
	}
}

function createModelAndEnsureIndex(Model: Model<PluginDocument>, obj: any, cb: CallableFunction): void {
	const doc = new Model(obj)
	doc.save(function (err) {
		if (err) return cb(err)
		
		doc.on('es-indexed', function () {
			setTimeout(function () {
				cb(null, doc)
			}, INDEXING_TIMEOUT)
		})
	})
}

async function createModelAndSave (Model: Model<PluginDocument>, obj: any): Promise<PluginDocument> {
	const dude = new Model(obj)
	return await dude.save()
}

function saveAndWaitIndex (doc: PluginDocument, cb: CallableFunction): void {
	doc.save(function (err) {
		if (err) cb(err)
		else {
			doc.once('es-indexed', cb)
			doc.once('es-filtered', cb)
		}
	})
}

function bookTitlesArray(): Array<string> {
	const books = [
		'American Gods',
		'Gods of the Old World',
		'American Gothic'
	]
	let idx
	for (idx = 0; idx < 50; idx++) {
		books.push('Random title ' + idx)
	}
	return books
}

export const config = {
	mongoUrl: 'mongodb://localhost/mongoosastic-test',
	mongoOpts: {
		useNewUrlParser: true,
		useFindAndModify: false,
		useUnifiedTopology: true
	},
	INDEXING_TIMEOUT: INDEXING_TIMEOUT,
	BULK_ACTION_TIMEOUT: BULK_ACTION_TIMEOUT,
	deleteIndexIfExists: deleteIndexIfExists,
	deleteDocs: deleteDocs,
	createModelAndEnsureIndex: createModelAndEnsureIndex,
	createModelAndSave: createModelAndSave,
	saveAndWaitIndex: saveAndWaitIndex,
	bookTitlesArray: bookTitlesArray,
	getClient: function () {
		return esClient
	},
	close: function () {
		esClient.close()
	}
}

