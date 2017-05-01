const gandalf = require('../../utils/gandalf')
const _fields = Symbol('fields')
const _children = Symbol('children')
const _writables = Symbol('writables')

const unknownFieldError = (field, schema) => {
  const msg = `Unknown field ${field} has been requested from Schema ${schema}`
  throw new Error(msg)
}

class Schema {
  /**
   * Loops through a schema config object and splits fields into categories: children, writables, and local fields
   *
   * @static
   * @param {Schema} schemaObj
   * @param {object} config
   *
   * @memberOf Schema
   */
  static buildSchema (schemaObj, config) {
    const fields = new Map()
    const children = new Map()
    const writables = new Map()
    // always add id to Schema
    fields.set('id', 'Id')
    Object.keys(config).forEach(field => {
      const value = config[field]
      if (typeof value === 'string') {
        return fields.set(field, value)
      }
      if (value instanceof Schema) {
        return children.set(field, value)
      }
      // this is an object with a customized configuration
      fields.set(field, value.sf)
      if (value.writable) {
        writables.set(field, value.sf)
      }
    })
    // attach symbols to schemaObj
    schemaObj[_fields] = fields
    schemaObj[_children] = children
    schemaObj[_writables] = writables
  }

  /**
   * Creates an instance of Schema.
   * @param {string} sfObject
   * @param {object} config
   *
   * @memberOf Schema
   */
  constructor (sfObject, config) {
    gandalf.checkType(sfObject, 'string', 'Schema(sfObject, ..)')
    gandalf.checkType(config, 'Object', 'Schema(.., config)')
    Object.defineProperty(this, 'sfObject', {
      value: sfObject
    })
    Schema.buildSchema(this, config)
    this.writablesProxy = this.createWritablesProxy()
  }

  /**
   * Returns mapping of a field on a schema.
   *
   * @param string field
   * @returns string | undefined
   *
   * @memberOf Schema
   */
  getFieldMapping (field) {
    if (this[_fields].get(field)) {
      return this[_fields].get(field)
    }
    if (this[_children].get(field)) {
      return this[_children].get(field).sfObject
    }
  }

  /**
   * Gets all fields in a Schema tree by starting at root and then recursing through children to get their fields. Child fields are concatenated with the name of the relationship that the parent holds
   * ['name', 'id'] -> ['project.name', 'project.id']
   *
   * @returns array
   *
   * @memberOf Schema
   */
  getAllFields () {
    let fields = []
    this[_fields].forEach((val, key) => {
      fields.push(key)
    })
    this[_children].forEach((schema, name) => {
      fields = [
        ...fields,
        ...schema.getAllFields().map(field => `${name}.${field}`)
      ]
    })
    return fields
  }

  mapResults (query) {

  }

  /**
   * Get local fields from a schema object not including children references
   *
   * @returns array
   *
   * @memberOf Schema
   */
  getLocalFields () {
    let locals = []
    this[_fields].forEach((sf, mapping) => locals.push(mapping))
    return locals
  }

  /**
   * Returns all writable fields that a schema holds. This is used so that Doc objects know what fields they can then save back to SalesForce
   *
   * @returns array
   *
   * @memberOf Schema
   */
  getAllWritables () {
    const writables = {}
    this[_writables].forEach((mapping, key) => {
      writables[key] = mapping
    })
    return writables
  }

  /**
   * Given a collection of fields this function will expand all the fields that are schema nodes into all of their local fields
   *
   * @param {array} fields
   * @returns {array} expandedFields
   *
   * @memberof Schema
   */
  expandFields (fields) {
    return fields.reduce((expanded, field) => {
      const path = field.split('.')
      if (path.length === 1) {
        // is it a field or a child schema
        if (this[_fields].get(field)) {
          expanded.push(field)
          return expanded
        }
        if (this[_children].get(field)) {
          return [
            ...expanded,
            ...this[_children].get(field).getLocalFields().map(childField =>
              `${field}.${childField}`
            )
          ]
        }
      }
      // path consists of multiple segments
      const front = path.shift()
      const child = this[_children].get(front)
      if (!child) {
        unknownFieldError(front, this.sfObject)
      }
      return [
        ...expanded,
        ...child.expandFields([path.join('.')]).map(childField =>
          `${front}.${childField}`
        )
      ]
    }, [])
  }

  /**
   * Given a collection of fields return the SalesForce mapping of the fields
   *
   * @param array fields
   * @returns array
   *
   * @memberOf Schema
   */
  mapFields (fields) {
    return fields.reduce((mappedFields, field) => {
      const path = field.split('.')
      if (path.length === 1) {
        const mapping = this.getFieldMapping(field)
        if (!mapping) {
          unknownFieldError(field, this.sfObject)
        }
        mappedFields.push(mapping)
        return mappedFields
      }
      const front = path.shift()
      const child = this[_children].get(front)
      if (!child) {
        unknownFieldError(front, this.sfObject)
      }
      return [
        ...mappedFields,
        ...child.mapFields([path.join('.')]).map(field =>
          `${child.sfObject}.${field}`
        )
      ]
    }, [])
  }

  /**
   * Creates a Proxy handler to deal with fields that a model might want to edit and then save
   *
   * @returns object
   *
   * @memberof Schema
   */
  createWritablesProxy () {
    return {
      writables: this.getAllWritables(),
      set (doc, key, value) {
        if (key in this.writables) {
          // TODO: Type checking will happen here eventually
          doc._changeset[this.writables[key]] = value
        }
        doc[key] = value
        return true
      }
    }
  }
}

module.exports = Schema