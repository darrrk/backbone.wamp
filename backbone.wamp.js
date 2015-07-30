/* eslint-env amd, browser, node */

(function () {
  "use strict";

  var globalVar = typeof global !== "undefined" ? global : window,
    factory = function (_, Backbone, autobahn) {
      var actionMap = {
        POST: "create",
        PUT: "update",
        PATCH: "patch",
        DELETE: "delete",
        GET: "read"
      },

        actions = _.values(actionMap),

        capitalizeFirstLetter = function (string) {
          return string.charAt(0).toUpperCase() + string.slice(1);
        },

        getPromise = function (defer) {
          if (_.isFunction(defer.promise)) {
            return defer;
          } else {
            return defer.promise;
          }
        },

        getWampConnection = function (object) {
          return object.wampConnection || globalVar.WAMP_CONNECTION;
        },

        getWampMyId = function (object) {
          if (object.collection && object.collection.wampMyId) {
            return _.result(object.collection, "wampMyId");
          } else if (object.wampMyId) {
            return _.result(object, "wampMyId");
          } else {
            return _.result(globalVar, "WAMP_MY_ID");
          }
        },

        getWampOtherId = function (object) {
          if (object.collection && object.collection.wampOtherId) {
            return _.result(object.collection, "wampOtherId");
          } else if (object.wampOtherId) {
            return _.result(object, "wampOtherId");
          } else {
            return _.result(globalVar, "WAMP_OTHER_ID");
          }
        },

        getWampAuth = function (object) {
          return object.wampAuth || globalVar.WAMP_AUTH || function () {
            var connection = getWampConnection(object),
              defer = connection.defer();
            defer.resolve(true);
            return getPromise(defer);
          };
        },

        getWampUri = function (object) {
          return object.wampGetUri || function (uri, peerId, action) {
            if (globalVar.WAMP_GET_URI) {
              return globalVar.WAMP_GET_URI.apply(object, arguments);
            } else {
              return uri + "." + peerId + "." + action;
            }
          };
        },

        attachHandlers = function (uriKey) {
          var self = this,
            uri = _.result(this, uriKey),
            wampMyId = getWampMyId(this),
            connection = getWampConnection(this);
          if (!uri || !wampMyId) {
            return;
          }
          _.each(actions, function (action) {
            connection.session.register(
              getWampUri(self)(uri, wampMyId, action),
              function (args, kwargs, details) {
                var defer = connection.defer();
                getWampAuth(self)({
                    action: action,
                    uri: uri,
                    wampMyId: wampMyId
                  },
                  kwargs, details
                )
                .then(function (isAuth) {
                  if (isAuth === true) {
                    try {
                      kwargs.data = JSON.parse(kwargs.data);
                    } catch (e) {} // eslint-disable-line
                    if (_.isFunction(self["wamp" + capitalizeFirstLetter(action)])) {
                      defer.resolve(
                        self["wamp" + capitalizeFirstLetter(action)](
                          kwargs, details
                        )
                      );
                    } else {
                      defer.resolve(
                        new autobahn.Error("Not defined procedure for action: " + action)
                      );
                    }
                  } else {
                    defer.resolve(new autobahn.Error("Auth error"));
                  }
                });
                return getPromise(defer);
              }
            );
          });
        },

        backboneAjaxOriginal = Backbone.ajax,


        WampModel = Backbone.Model.extend({
          constructor: function (attributes, options) {
            if (options == null) {
              options = {};
            }
            Backbone.Model.call(this, attributes, options);
            if (!options.collection) {
              attachHandlers.call(this, "urlRoot");
            }
          },
          sync: function (method, model, options) {
            return Backbone.Model.prototype.sync.call(this, method, model, _.extend(
              options || {},
              {wampEntity: model, wampModelId: model.id}
            ));
          }
        }),

        WampCollection = Backbone.Collection.extend({
          constructor: function () {
            Backbone.Collection.apply(this, arguments);
            attachHandlers.call(this, "url");
          },
          model: WampModel,
          sync: function (method, collection, options) {
            return Backbone.Collection.prototype.sync.call(this, method, collection,
              _.extend(options || {}, {wampEntity: collection})
            );
          }
        });


      Backbone.ajax = function (ajaxOptions) {
        var connection, defer,
          uri = ajaxOptions.wampModelId ? ajaxOptions.url.replace(
            new RegExp("/" + ajaxOptions.wampModelId + "$"), ""
          ) : ajaxOptions.url;
        if (!ajaxOptions.wampEntity) {
          return backboneAjaxOriginal(ajaxOptions);
        }
        connection = getWampConnection(ajaxOptions.wampEntity);
        defer = connection.defer();
        connection.session.call(
          getWampUri(ajaxOptions.wampEntity)(
            uri,
            getWampOtherId(ajaxOptions.wampEntity),
            actionMap[ajaxOptions.type]
          ),
          [],
          {
            data: ajaxOptions.data,
            extra: _.extend(
              ajaxOptions.wampExtra || {},
              {
                wampModelId: ajaxOptions.wampModelId,
                wampMyId: getWampMyId(ajaxOptions.wampEntity)
              }
            )
          },
          ajaxOptions.wampOptions
        )
        .then(function (obj) {
          if (obj.error) {
            ajaxOptions.error(obj);
            defer.reject(obj);
          } else {
            ajaxOptions.success(obj);
            defer.resolve(obj);
          }
        }, function (obj) {
          ajaxOptions.error(obj);
          defer.reject(obj);
        });
        return getPromise(defer);
      };

      Backbone.WampModel = WampModel;
      Backbone.WampCollection = WampCollection;

      return {
        Model: WampModel,
        Collection: WampCollection
      };
    };

  if (typeof define === "function" && define.amd) {
    define(["underscore", "backbone", "autobahn"], function (_, Backbone, autobahn) {
      return factory(_, Backbone, autobahn);
    });
  } else if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(
      require("underscore"),
      require("backbone"),
      require("autobahn")
    );
  } else {
    factory(globalVar._, globalVar.Backbone, globalVar.autobahn);
  }
}());
