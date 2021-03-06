var models = require("../../models")
  , Serializer = models.Serializer
  , UserSerializer = models.UserSerializer

exports.addSerializer = function() {
  return new Serializer("comments", {
    select: ['id', 'body', 'createdAt', 'updatedAt', 'createdBy', 'postId'],
    createdBy: { through: UserSerializer, embed: true }
  })
}
