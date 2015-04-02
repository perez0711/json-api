"use strict";

var _classCallCheck = require("babel-runtime/helpers/class-call-check")["default"];

var _createClass = require("babel-runtime/helpers/create-class")["default"];

var _core = require("babel-runtime/core-js")["default"];

var _interopRequire = require("babel-runtime/helpers/interop-require")["default"];

var Q = _interopRequire(require("q"));

var templating = _interopRequire(require("url-template"));

var jade = _interopRequire(require("jade"));

var Negotiator = _interopRequire(require("negotiator"));

var path = _interopRequire(require("path"));

var Response = _interopRequire(require("../types/HTTP/Response"));

var Document = _interopRequire(require("../types/Document"));

var Collection = _interopRequire(require("../types/Collection"));

var Resource = _interopRequire(require("../types/Resource"));

var DocumentationController = (function () {
  function DocumentationController(registry, apiInfo, templatePath) {
    var _this = this;

    _classCallCheck(this, DocumentationController);

    var defaultTempPath = "../../../templates/documentation.jade";
    this.template = templatePath || path.resolve(__dirname, defaultTempPath);
    this.registry = registry;

    // compute template data on construction
    // (it never changes, so this makes more sense than doing it per request)
    var data = _core.Object.assign({}, apiInfo);
    data.resourcesMap = {};

    // Store in the resourcesMap the info object about each type,
    // as returned by @getTypeInfo.
    this.registry.types().forEach(function (type) {
      data.resourcesMap[type] = _this.getTypeInfo(type);
    });

    this.templateData = data;
  }

  _createClass(DocumentationController, {
    handle: {
      value: function handle(request) {
        var response = new Response();
        var negotiator = new Negotiator({ headers: { accept: request.accepts } });
        var contentType = negotiator.mediaType(["text/html", "application/vnd.api+json"]);

        // set content type as negotiated
        response.contentType = contentType;

        if (contentType === "text/html") {
          response.body = jade.renderFile(this.template, this.templateData);
        } else {
          // Create a collection of "jsonapi-descriptions" from the templateData
          var descriptionResources = new Collection();

          // Add a description resource for each resource type to the collection.
          for (var type in this.templateData.resourcesMap) {
            var typeInfo = this.templateData.resourcesMap[type];

            // Build attributes for this description resource.
            var attrs = _core.Object.assign({}, typeInfo);
            attrs.fields = [];
            attrs.name = {
              singular: attrs.singularName,
              plural: attrs.pluralName,
              model: attrs.name
            };

            delete attrs.schema;
            delete attrs.singularName;
            delete attrs.pluralName;

            // populate the `fields` attribute with a description of each field
            for (var _path in typeInfo.schema) {
              var fieldDesc = {
                name: _path,
                friendlyName: typeInfo.schema[_path].friendlyName,
                kind: typeInfo.schema[_path].type,
                description: typeInfo.schema[_path].description,
                requirements: {
                  required: !!typeInfo.schema[_path].required
                }
              };

              if (typeInfo.schema[_path].enumValues) {
                fieldDesc.oneOf = typeInfo.schema[_path].enumValues;
              }

              var fieldDefault = typeInfo.schema[_path]["default"];
              fieldDesc["default"] = fieldDefault === "(auto generated)" ? "__AUTO__" : fieldDefault;

              attrs.fields.push(fieldDesc);
            }

            var typeDescription = new Resource("jsonapi-descriptions", type, attrs);
            descriptionResources.add(typeDescription);
          }

          response.body = new Document(descriptionResources).get(true);
        }

        return Q(response);
      }
    },
    getTypeInfo: {

      // Clients can extend this if, say, the adapter can't infer
      // as much info about the models' structure as they would like.

      value: function getTypeInfo(type) {
        var adapter = this.registry.adapter(type);
        var modelName = adapter.constructor.getModelName(type);
        var model = adapter.getModel(modelName);

        // Combine the docs in the Resource description with the standardized schema
        // from the adapter in order to build the final schema for the template.
        var info = this.registry.info(type);
        var schema = adapter.constructor.getStandardizedSchema(model);
        var ucFirst = function (v) {
          return v.charAt(0).toUpperCase() + v.slice(1);
        };

        for (var _path in schema) {
          // look up user defined field info on info.fields.
          var pathInfo = info && info.fields && info.fields[_path];

          if (pathInfo && pathInfo.description) {
            schema[_path].description = pathInfo.description;
          }

          // but, below, set a default friendly name if none is provided.
          if (pathInfo && pathInfo.friendlyName) {
            schema[_path].friendlyName = pathInfo.friendlyName;
          }

          // specifically generate targetType from targetModel on relationship fields.
          if (schema[_path].type) {
            if (schema[_path].type.targetModel) {
              schema[_path].type.targetType = adapter.constructor.getType(schema[_path].type.targetModel);
            } else {
              schema[_path].type.targetType = null;
            }

            // and generate typeString from the type object.
            var typeObject = schema[_path].type;
            var targetModel = typeObject.targetModel;

            var typeString = typeObject.isArray ? "Array[" : "";
            typeString += targetModel ? targetModel + "Id" : typeObject.name;
            typeString += typeObject.isArray ? "]" : "";

            schema[_path].typeString = typeString;
          }
        }

        // Other info
        var result = {
          name: modelName,
          singularName: adapter.constructor.toFriendlyName(modelName),
          pluralName: type.split("-").map(ucFirst).join(" "),
          schema: schema,
          parentType: this.registry.parentType(type),
          childTypes: adapter.constructor.getChildTypes(model)
        };

        var defaultIncludes = this.registry.defaultIncludes(type);
        if (defaultIncludes) result.defaultIncludes = defaultIncludes;

        if (info && info.example) result.example = info.example;
        if (info && info.description) result.description = info.description;

        return result;
      }
    }
  });

  return DocumentationController;
})();

module.exports = DocumentationController;