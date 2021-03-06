import chai, { expect, assert } from 'chai'
import chaiAsPromised from 'chai-as-promised'

import hooks from 'feathers-hooks'
import memory from 'feathers-memory'
import feathers from 'feathers'

import versions, { addVersion, clearVersions, getVersion } from '../src'
import { quickApp, quickService } from './commons'
import { iff } from 'feathers-hooks-common'

chai.use(chaiAsPromised)

/* global describe it */

describe('addVersion hook', done => {

  it('requires a version service to be initialized', () => {

    const app = feathers()
      .configure(hooks())

    const messages = app
      .use('messages', memory())
      .service('messages')
      .hooks({
        after: {
          create: addVersion()
        }
      })

    return expect(messages.create({ body: 'Success!' }))
      .to.eventually.be
      .rejectedWith('Version service not initialized.')
  })

  it('can only be used as an "after" "patch", "create" or "update" hook', async () => {

    let app = quickApp()

    const add = addVersion()

    const before = { all: add }
    const after = before

    let messages = app.use('messages', memory())
      .service('messages')
      .hooks({ before })

    let err = 'The \'add-version\' hook can only be used as a \'after\' hook'

    await expect(messages.find({})).to.eventually.be.rejectedWith(err)
    await expect(messages.get(0)).to.eventually.be.rejectedWith(err)
    await expect(messages.patch(0, {})).to.eventually.be.rejectedWith(err)
    await expect(messages.update(0, {})).to.eventually.be.rejectedWith(err)
    await expect(messages.remove(0)).to.eventually.be.rejectedWith(err)

    app = quickApp()
    messages = app.use('messages', memory())
      .service('messages')
      .hooks({ after })

    await expect(messages.create({ body: 'Success!' })).to.eventually.be.fulfilled
    await expect(messages.patch(0, { body: 'Horray!' })).to.eventually.be.fulfilled
    await expect(messages.update(0, { body: 'Fantastic!' })).to.eventually.be.fulfilled

    err = 'The \'add-version\' hook can only be used on the \'["update","patch","create"]\' service method(s).'

    await expect(messages.find({})).to.eventually.be.rejectedWith(err)
    await expect(messages.get(0)).to.eventually.be.rejectedWith(err)
    await expect(messages.remove(0)).to.eventually.be.rejectedWith(err)

  })

  it('creates a version on save', async () => {

    const app = quickApp()
    const messages = quickService(app)

    const message = await messages.create({ text: 'New message', urgent: false })
    const versions = app.service('versions')

    const { id } = message

    const version = await versions.find({ query: { document: id, service: 'messages' } })

    assert.deepEqual(message, version[0].list[0].data)

  })

  it('handles array-data creates', async () => {

    const app = quickApp()
    const messages = quickService(app)

    const data = []
    for (let i = 0; i < 10; i++)
      data.push({ body: `Message number ${i}` })

    const many = await messages.create(data)

    for (const doc of many) {
      const { id } = doc

      const vs = await app.service('versions').find({ query: { document: id } })

      assert.deepEqual(doc, vs[0].list[0].data)
    }

  })

  describe('limit parameter', () => {

    it('must be a number above 1', () => {
      const app = quickApp()
      const err = 'GeneralError: limit must be a number above 1'
      expect(() => quickService(app, { limit: -1 })).to.throw(err)
      expect(() => quickService(app, { limit: 0 })).to.throw(err)
      expect(() => quickService(app, { limit: 1 })).to.throw(err)
      expect(() => quickService(app, { limit: 2 })).to.not.throw()
      expect(() => quickService(app, { limit: 'Foo' })).to.throw(err)
    })

    it('limits the number of versions that are saved in the back end', async () => {

      const app = quickApp()
      const limit = 5
      const messages = quickService(app, { limit })

      const message = await messages.create({ author: 'Bruce', body: 'Rough Draft' })

      for (let i = 0; i <= limit * 2; i++)
        await messages.patch(message.id, { body: `Revision ${i + 1}` })

      const [ version ] = await app.service('versions').find({ query: { document: message.id } })

      assert.equal(version.list.length, limit, 'Limit does not limit the number of items.')

    })

  })

  describe('saveInterval parameter', () => {

    it('if defined, must be a number above 0', () => {
      const app = quickApp()
      const err = 'GeneralError: saveInterval must be a number equal to or above 0'
      expect(() => quickService(app, { saveInterval: -1 })).to.throw(err)
      expect(() => quickService(app, { saveInterval: 0 })).to.not.throw(err)
      expect(() => quickService(app, { saveInterval: 10 })).to.not.throw(err)
      expect(() => quickService(app, { saveInterval: 'Cake' })).to.throw(err)
    })

    it('collapses versions created within [saveInterval] ms of each other', async () => {
      const app = quickApp()
      const ms = 5
      const messages = quickService(app, { saveInterval: ms })

      const message = await messages.create({ author: 'Steve', body: 'Hello worl' })

      await messages.patch(message.id, { body: 'Hello world.' })
      let [ version ] = await app.service('versions').find({ query: { document: message.id } })

      assert.equal(version.list.length, 1, 'saveInterval does not work.')

      await new Promise(resolve => setTimeout(resolve, ms * 2))

      await messages.patch(message.id, { body: 'Hello world!' });
      ([ version ] = await app.service('versions').find({ query: { document: message.id } }))

      assert.equal(version.list.length, 2, 'saveInterval does not work.')

    })

  })

  describe('includeMask', () => {

    it('cannot be defined with an excludeMask', () => {
      const app = quickApp()

      expect(() => quickService(app, { excludeMask: ['_id', 'name'], includeMask: ['data'] }))
        .to.throw('you may only supply excludeMask OR includeMask')
    })

    it('must be an array of strings', async () => {
      const app = quickApp()

      const excludeMasksBad = [
        [], [1], [1, false, Symbol('not-a-string')], [() => 'not a string', 1], ['string', /notAString/],
        'string', {}, false, Infinity
      ]

      for (const excludeMask of excludeMasksBad)
        expect(() => quickService(app, { excludeMask }))
          .to.throw('excludeMask, if provided, must be an Array of strings.')

      const excludeMasksGood = [
        ['fine'], ['1', 's09', '', '100'], null, undefined
      ]

      for (const excludeMask of excludeMasksGood)
        expect(() => quickService(app, { excludeMask }))
          .to.not.throw(Error)

    })

    it('masks data saved to a version by including fields', async () => {

      const app = quickApp()

      const messages = quickService(app, { includeMask: [ 'body' ] })

      const msg = await messages.create({ created: new Date(), body: 'New message' })

      await messages.patch(msg.id, { body: 'Patched Message' })

      const version = await app::getVersion('messages', msg.id)

      const data = version.list.map(item => item.data)

      assert.deepEqual(data, [ { body: 'New message' }, { body: 'Patched Message' } ])

    })

  })

  describe('excludeMask', () => {

    it('cannot be defined with an includeMask', () => {
      const app = quickApp()

      expect(() => quickService(app, { excludeMask: ['_id', 'name'], includeMask: ['data'] }))
        .to.throw('you may only supply excludeMask OR includeMask')
    })

    it('must be an array of strings', async () => {
      const app = quickApp()

      const includeMasksBad = [
        [], [1], [1, false, Symbol('not-a-string')], [() => 'not a string', 1], ['string', /notAString/],
        'string', {}, false, Infinity
      ]

      for (const includeMask of includeMasksBad)
        expect(() => quickService(app, { includeMask }))
          .to.throw('includeMask, if provided, must be an Array of strings.')

      const includeMasksGood = [
        ['fine'], ['1', 's09', '', '100'], null, undefined
      ]

      for (const includeMask of includeMasksGood)
        expect(() => quickService(app, { includeMask }))
          .to.not.throw(Error)

    })

    it('masks data saved to a version by excluding fields', async () => {
      const app = quickApp()

      const messages = quickService(app, { excludeMask: [ 'id', 'created' ] })

      const msg = await messages.create({ created: new Date(), body: 'New message' })

      await messages.patch(msg.id, { body: 'Patched Message' })

      const version = await app::getVersion('messages', msg.id)

      const data = version.list.map(item => item.data)

      assert.deepEqual(data, [ { body: 'New message' }, { body: 'Patched Message' } ])

    })

  })

})

describe('clearVersions hook', () => {

  it('can only be used as an "after" "remove" hook.', async () => {

    let app = quickApp()

    const clear = clearVersions()

    const before = { all: clear }
    const after = before

    let messages = app.use('messages', memory())
      .service('messages')
      .hooks({ before })

    let err = 'The \'clear-versions\' hook can only be used as a \'after\' hook.'

    await expect(messages.find({})).to.eventually.be.rejectedWith(err)
    await expect(messages.get(0)).to.eventually.be.rejectedWith(err)
    await expect(messages.patch(0, {})).to.eventually.be.rejectedWith(err)
    await expect(messages.update(0, {})).to.eventually.be.rejectedWith(err)
    await expect(messages.remove(0)).to.eventually.be.rejectedWith(err)

    app = quickApp()
    messages = app.use('messages', memory())
      .service('messages')
      .hooks({ after })

    err = 'The \'clear-versions\' hook can only be used on the \'["remove"]\' service method(s).'

    await expect(messages.create({ body: 'Success!' })).to.eventually.be.rejectedWith(err)
    await expect(messages.patch(0, { body: 'Horray!' })).to.eventually.be.rejectedWith(err)
    await expect(messages.update(0, { body: 'Fantastic!' })).to.eventually.be.rejectedWith(err)
    await expect(messages.find({})).to.eventually.be.rejectedWith(err)
    await expect(messages.get(0)).to.eventually.be.rejectedWith(err)

    app = quickApp()
    messages = app.use('messages', memory())
      .service('messages')
      .hooks({ after: { remove: clearVersions() } })

    await messages.create({ body: 'This is a sweet message' })
    await expect(messages.remove(0)).to.eventually.be.fulfilled

  })

  it('removes versions associated with a successfully deleted document', async () => {
    const app = quickApp()

    const messages = quickService(app)
    const message = await messages.create({ author: 'Jerry', body: 'Jerry\'s message!' })

    await messages.remove(message.id)

    const [ version ] = await app.service('versions').find({ query: { document: message.id, service: 'messages' } })

    assert.equal(version, undefined, 'Version not deleted!')

  })

  it('handles query removals', async () => {

    const app = quickApp()

    const messages = quickService(app)
    for (let i = 0; i < 5; i++)
      await messages.create({ author: '0', body: 'Foobar' })

    const ids = (await messages.find({})).map(doc => doc.id)

    await messages.remove(null, { query: { id: { $in: ids } } })

    for (const id of ids) {
      const [ version ] = await app.service('versions').find({ query: { document: id, service: 'messages' } })
      assert.equal(version, undefined, 'Version not deleted!')
    }

  })

  it('composes without error', async () => {

    const app = feathers()
      .configure(hooks())
      .configure(versions())

    const messages = app
      .use('messages', memory())
      .service('messages')
      .hooks({
        after: {
          create: addVersion(),
          remove: iff(hook => true, clearVersions())
        }
      })

    await messages.create([{ body: 'HAHA' }, { body: 'Hammertime' }])

    await expect(messages.remove(null)).to.eventually.be.fulfilled

  })

})
