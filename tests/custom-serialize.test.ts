'use strict'

import mongoose, { Document, Schema } from 'mongoose'
import { config } from './config'
import mongoosastic from '../lib/index'
import { Options } from 'types'

const FoodSchema = new Schema({
	name: {
		type: String
	}
})
FoodSchema.virtual('type').get(() => { return 'dinner' })
FoodSchema.set('toObject', { getters: true, virtuals: true, versionKey: false })

FoodSchema.plugin(mongoosastic, {
	customSerialize: function(model: Document) {
		const data = model.toObject()
		delete data.id
		delete data._id
		return data
	}
} as Options)

const Food = mongoose.model('Food', FoodSchema)

describe('Custom Serialize', function () {
	beforeAll(async function() {
		await mongoose.connect(config.mongoUrl, config.mongoOpts)
		await Food.deleteMany()
		await config.deleteIndexIfExists(['foods'])
	})

	afterAll(async function() {
		await Food.deleteMany()
		await config.deleteIndexIfExists(['foods'])
		mongoose.disconnect()
	})

	it('should index all fields returned from the customSerialize function', function (done) {

		config.createModelAndEnsureIndex(Food, { name: 'pizza' }, function() {
			Food.search({
				query_string: {
					query: 'pizza'
				} 
			}, {}, (searchError, results) => {
				if (searchError) return done(searchError)
				const source = results?.body.hits.hits[0]._source
				
				expect(source.name).toEqual('pizza')
				expect(source.type).toEqual('dinner')
				done()
			})
		})
	})
})
