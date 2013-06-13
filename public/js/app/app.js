App = Ember.Application.create({
  LOG_TRANSITIONS: true
});

App.Properties = Ember.Object.extend({
  isAuthorized: false,
  username: currentUsername,
  userId: currentUser,

  currentPath: null
})
App.properties = App.Properties.create()

App.Helpers = Ember.Object.extend({
  handleAjaxError: function(r) {
    window.location.href = "/";
  }
})
App.helpers = App.Helpers.create()

App.ShowSpinnerWhileRendering = Ember.Mixin.create({
  layout: Ember.Handlebars.compile('<div {{bindAttr class="isLoaded"}}>{{ yield }}</div>'),

  classNameBindings: ['isLoaded::loading'],

  isLoaded: function() {
    return !!this.get('isInserted') && !!this.get('controller.isLoaded')
  }.property('isInserted', 'controller.isLoaded'),

  didInsertElement: function() {
    this.set('isInserted', true);
    this._super();
  }
});

App.PaginationHelper = Ember.Mixin.create({
  pageSize: 25,
  pageStart: 0,

  nextPage: function() {
    this.incrementProperty('pageStart', this.get('pageSize'))
  },

  prevPage: function() {
    this.decrementProperty('pageStart', this.get('pageSize'))
  },

  prevPageDisabled: function() {
    return this.get('pageStart') === 0 ? 'disabled' : ''
  }.property('pageStart'),

  prevPageVisible: function() {
    return this.get('prevPageDisabled') !== 'disabled'
  }.property('prevPageDisabled'),

  nextPageVisible: function() {
    return this.get('nextPageDisabled') !== 'disabled'
  }.property('nextPageDisabled'),

  nextPageDisabled: function() {
    var len = this.get('content.content.length')
    return len === 0 || len < this.get('pageSize') ? 'disabled' : ''
  }.property('content.content.length', 'pageSize'),

  resetPage: function() {
    this.set('pageStart', 0)
  },

  pageDidChange: function() {
    this.didRequestRange(this.get('pageStart'));
  }.observes('pageStart')
});

App.Pagination = Ember.View.extend({
  templateName: 'pagination'
});

App.Tag = Ember.Object.extend({
  content: {}
})
App.Tag.reopenClass({
  resourceUrl: '/v1/tags',

  findAll: function() {
    var tags = Ember.ArrayProxy.create({content: []});

    $.ajax({
      url: this.resourceUrl,
      context: this,
      type: 'get',
      success: function(response) {
        response.forEach(function(attrs) {
          // TODO: return attrs as an object
          var tag = App.Tag.create({name: encodeURIComponent(attrs)})
          tags.addObject(tag)
        })
      },
      error: App.helpers.handleAjaxError
    })

    return tags
  }
})

App.TagsController = Ember.ArrayController.extend({})

App.Tags = Ember.View.extend({
  templateName: 'tags',
  tagName: 'ul'
});

App.Group = Ember.Object.extend({
  content: {}
})
App.Group.reopenClass({
  resourceUrl: '/v1/users',
  suffix: '/subscriptions',

  findAll: function() {
    var groups = Ember.ArrayProxy.create({content: []});

    var success = function(response) {
      response.forEach(function(attrs) {
        // NOTE: since there is no difference between a user and a
        // group we need to process all subscriptions and select
        // only and only objects that are:
        // 1) group
        // 2) this is not me
        // TODO: review the second condition
        if (attrs.user.type === 'group' &&
            groups.indexOf(attrs.user.username) === -1 &&
            attrs.name === 'Posts') {
          // TODO: build Group object instead of using attrs directly
          groups.addObject(attrs)
        }
      })
    }

    $.ajax({
      url: this.resourceUrl + '/' + App.properties.get('username') + this.suffix,
      context: this,
      type: 'get',
      success: success,
      error: App.helpers.handleAjaxError
    })

    return groups
  },

  make: function(attrs, options) {
    $.ajax({
      url: this.resourceUrl,
      type: 'post',
      data: attrs,
      dataType: 'jsonp',
      success: options && options.success ? options.success : null,
      error: options && options.error ? options.error : null
    });
    return this;
  }
});

App.GroupsController = Ember.ArrayController.extend({
  make: function() {
    var controller = this;

    App.Group.make({
      username: this.get("name")
    }, {
      success: function() {
        controller.transitionToRoute("user", controller.get("name"));
      },
      error: function() {
        controller.transitionToRoute("groups");
      }
    });
  }
})

App.GroupsView = Ember.View.extend({
  templateName: 'groups',
  tagName: 'ul'
});

App.CometController = Ember.Controller.extend({
  needs: ['timeline', 'search', 'post'],

  subscribedTo: {},

  // TODO: review this method -- hacky solution
  currentController: function() {
    switch (App.properties.get('currentPath')) {
    case 'home':
    case 'comments':
    case 'likes':
    case 'posts':
    case 'public':
      return this.get('controllers.timeline')
    case 'search':
      return this.get('controllers.search')
    case 'post':
      return this.get('controllers.post')
    }
  },

  findPost: function(postId) {
    var currentController = this.currentController()
    if (currentController.constructor === App.PostController)
      return currentController.get('content')
    else
      return currentController.get('content.posts').find(function(post) {
        return post.id === postId
      })
  },

  isFirstPage: function() {
    var pageStart = this.currentController().get('pageStart')
    return pageStart === 0 ||
      pageStart === undefined
  },

  newPost: function(data) {
    if (!this.isFirstPage())
      return

    var post = App.Post.create(data.post)
    this.currentController().get('posts').addObject(post)
  },

  updatePost: function(data) {
    var post = this.findPost(data.post.id)

    if (post)
      post.set('body', data.post.body)
  },

  destroyPost: function(data) {
    var post = this.findPost(data.postId)
    this.currentController().get('content.posts').removeObject(post)
  },

  newComment: function(data) {
    if (!this.isFirstPage())
      return

    var comment = App.Comment.create(data.comment)
    var post = this.findPost(data.comment.postId)

    if (post) {
      post.comments.pushObject(comment)
    } else {
      post = App.Post.findOne(data.comment.postId)
      this.currentController().addObject(post)
    }
  },

  updateComment: function(data) {
    var post = this.findPost(data.comment.postId)

    var index = 0
    var comment = post.comments.find(function(comment) {
      index += 1
      if (comment && comment.id)
        return comment.id === data.comment.id
    })

    if (comment) {
      // FIXME: doesn't work as comment is not an Ember object
      // comment.set('body', data.comment.body)

      var updatedComment = App.Comment.create(data.comment)
      post.comments.removeObject(comment)
      post.comments.insertAt(index-1, updatedComment)
    }
  },

  destroyComment: function(data) {
    var post = this.findPost(data.postId)

    var comment = post.comments.findProperty('id', data.commentId)
    post.comments.removeObject(comment)
  },

  newLike: function(data) {
    if (!this.isFirstPage())
      return

    var user = App.User.create(data.user)
    var post = this.findPost(data.postId)

    if (post) {
      var like = post.likes.find(function(like) {
        return like.id == user.id
      })

      if (!like)
        post.likes.pushObject(user)
    } else {
      post = App.Post.findOne(data.postId)
      this.currentController().addObject(post)
    }
  },

  removeLike: function(data) {
    var post = this.findPost(data.postId)

    if (post)
      post.removeLike('id', data.userId)
  },

  disconnect: function(data) {
    this.reconnect();
  },

  init: function() {
    this._super();

    this.set('socket', io.connect('/'));

    this.get('socket').on('newPost', this.newPost.bind(this));
    this.get('socket').on('updatePost', this.updatePost.bind(this));
    this.get('socket').on('destroyPost', this.destroyPost.bind(this));

    this.get('socket').on('newComment', this.newComment.bind(this));
    this.get('socket').on('updateComment', this.updateComment.bind(this));
    this.get('socket').on('destroyComment', this.destroyComment.bind(this));

    this.get('socket').on('newLike', this.newLike.bind(this));
    this.get('socket').on('removeLike', this.removeLike.bind(this));

    this.get('socket').on('disconnect', this.disconnect.bind(this));
  },

  monitor: function() {
    var channel = this.get('channel')
    if (channel.constructor === App.Timeline)
      this.subscribe('timeline', channel.get('id'))
    else
      this.subscribe('post', channel.get('id'))
  }.observes('channel.id'),

  subscribe: function(channel, ids) {
    if (!ids) return;

    var subscribedTo = {};
    var that = this
    if (!$.isArray(ids))
      ids = [ids];

    if (this.subscribedTo[channel]) {
      ids.forEach(function(id) {
        var indexOfThisId = that.subscribedTo[channel].indexOf(id);
        if (indexOfThisId == -1) {
          that.subscribedTo[channel].push(id);
        }
      })
    } else {
      this.subscribedTo[channel] = ids;
    }

    subscribedTo[channel] = ids;
    this.socket.emit('subscribe', subscribedTo);
  },

  unsubscribe: function(channel, ids) {
    var unsubscribedTo = {};
    var that = this;

    if (channel && ids) {
      if (this.subscribedTo[channel]) {
        if (!$.isArray(ids)) {
          ids = [ids];
        }
        ids.forEach(function(id) {
          var indexOfThisId = that.subscribedTo[channel].indexOf(id);
          if (indexOfThisId != -1) {
            unsubscribedTo[channel].push(id);
            that.subscribedTo[channel].splice(indexOfThisId, 1);
          }
        })
      }
    } else if(channel && !ids) {
      unsubscribedTo[channel] = this.subscribedTo[channel];
      delete this.subscribedTo[channel];
    } else if (!channel) {
      unsubscribedTo = this.subscribedTo;
    }

    this.socket.emit('unsubscribe', unsubscribedTo);
  },

  reconnect: function() {
    var subscribedTo = this.get('subscribedTo');
    this.unsubscribe();
    this.get('socket').emit('subscribe', subscribedTo);
  }
})

App.ApplicationController = Ember.Controller.extend({
  needs: ['groups', 'tags', 'comet'],

  subscription: null,
  isLoaded: true,

  currentPathDidChange: function() {
    App.properties.set('currentPath', this.get('currentPath'));
  }.observes('currentPath'),

  searchPhrase: function() {
    // TODO: valueBinding instead
    query = App.searchController.body

    this.transitionToRoute('feedSearch', encodeURIComponent(query))
  }
});

App.ApplicationView = Ember.View.extend(App.ShowSpinnerWhileRendering, {
  templateName: 'application'
});

// Index view to display all posts on the page
App.SearchView = Ember.View.extend({
  templateName: 'search-list-view'
});

App.CreateSearchFieldView = Ember.TextField.extend(Ember.TargetActionSupport, {
  // TODO: Extract value from controller
  valueBinding: 'App.searchController.body',

  insertNewline: function() {
    this.triggerAction();
  }
})

// Index view to display all posts on the page
App.TimelineView = Ember.View.extend({
  templateName: 'timeline',

  submitPost: function() {
    this.get('controller').submitPost()
    // dirty way to restore original height of post textarea
    this.$().find('textarea').height('56px')
  }
});

// Separate CreatePostView to two fields:
// - new post
// - edit post or comment
App.CreatePostView = Ember.TextArea.extend(Ember.TargetActionSupport, {
  attributeBindings: ['class'],
  classNames: ['autogrow-short'],
  valueBinding: Ember.Binding.oneWay('controller.body'),

  insertNewline: function() {
    this.triggerAction();

    // dirty way to restore original height of post textarea
    this.$().find('textarea').height('56px')
  },

  didInsertElement: function() {
    this.$().autogrow();
  }
})

App.JustStarted = Ember.View.extend({
  templateName: 'just-started',

  justStarted: function() {
    return true
  }.property()
});

App.UploadFileView = Ember.TextField.extend({
  type: 'file',

  didInsertElement: function() {
    this.$().prettyInput()
  }
});

// View to display single post. Post has following subviews (defined below):
//  - link to show a comment form
//  - form to add a new comment
App.PartialPostView = Ember.View.extend({
  templateName: '_post',

  isFormVisible: false,
  isEditFormVisible: false,
  currentUser: currentUser,

  groupsNames: function() {
    if (!this.content.groups ||
        this.content.createdBy.username == this.content.groups.username ||
        (App.postsController.user &&
         App.postsController.user.username == this.content.groups.username))
      return null

    return this.content.groups.username
  }.property('this.content', 'App.postsController.user'),

  toggleVisibility: function() {
    this.toggleProperty('isFormVisible');
  },

  editFormVisibility: function() {
    this.toggleProperty('isEditFormVisible');
  },

  didInsertElement: function() {
    // wrap anchor tags around links in post text
    this.$().find('.text').anchorTextUrls();
    // wrap hashtags around text in post text
    this.$().find('.text').hashTagsUrls();
    // wrap search query around text in post text
    this.$().find('.text').highlightSearchResults(App.searchController.query);
    // please read https://github.com/kswedberg/jquery-expander/issues/24
    this.$().find('.text').expander({
      slicePoint: 350,
      expandPrefix: '&hellip; ',
      preserveWords: true,
      expandText: 'more&hellip;',
      userCollapseText: '',
      collapseTimer: 0,
      expandEffect: 'fadeIn',
      collapseEffect: 'fadeOut'
    })

    this.$().hide().slideDown('slow');
  },

  // FIXME: this leads to an emberjs error: "action is undefined"
  willDestroyElement: function() {
    if (this.$()) {
      var clone = this.$().clone();
      this.$().replaceWith(clone);
      clone.slideUp()
    }
  },

  showAllComments: function() {
    this.content.set('showAllComments', true)
  }
});

// View to display single post. Post has following subviews (defined below):
//  - link to show a comment form
//  - form to add a new comment
App.OwnPostContainerView = Ember.View.extend({
  templateName: 'own-post-view',
  isFormVisible: false,
  currentUser: currentUser,

  toggleVisibility: function() {
    this.toggleProperty('isFormVisible');
  },

  editFormVisibility: function() {
    this.toggleProperty('isEditFormVisible');
  },

  didInsertElement: function() {
    // wrap anchor tags around links in post text
    this.$().find('.text').anchorTextUrls();
    // wrap hashtags around text in post text
    this.$().find('.text').hashTagsUrls();
    // wrap search query around text in post text
    this.$().find('.text').highlightSearchResults(App.searchController.query);
    // please read https://github.com/kswedberg/jquery-expander/issues/24
    this.$().find('.text').expander({
      slicePoint: 350,
      expandPrefix: '&hellip; ',
      preserveWords: true,
      expandText: 'more&hellip;',
      userCollapseText: '',
      collapseTimer: 0,
      expandEffect: 'fadeIn',
      collapseEffect: 'fadeOut'
    })

    this.$().hide().slideDown('slow');
  },

  showAllComments: function() {
    this.content.set('showAllComments', true)
  }
});

App.CommentContainerView = Ember.View.extend({
  templateName: 'comment-view',
  isEditFormVisible: false,

  editFormVisibility: function() {
    this.toggleProperty('isEditFormVisible');
  },

  didInsertElement: function() {
    // wrap anchor tags around links in comments
    this.$().find('.body').anchorTextUrls();
    // wrap hashtags around text in post text
    this.$().find('.body').hashTagsUrls();
    // wrap search query around text in post text
    this.$().find('.body').highlightSearchResults(App.searchController.query);
    this.$().find('.body').expander({
      slicePoint: 512,
      expandPrefix: '&hellip; ',
      preserveWords: true,
      expandText: 'more&hellip;',
      userCollapseText: '',
      collapseTimer: 0,
      expandEffect: 'fadeIn',
      collapseEffect: 'fadeOut'
    })

    this.$().hide().slideDown('fast');
  },

  // FIXME: this leads to an emberjs error: "action is undefined"
  willDestroyElement: function() {
    if (this.$()) {
      var clone = this.$().clone();
      this.$().replaceWith(clone);
      clone.slideUp()
    }
  },

  commentOwner: function() {
    return this.content.createdBy.id == currentUser &&
      this.content.createdBy.username != 'anonymous'
  }.property(),

  destroyComment: function() {
    App.commentsController.destroyComment(this.content.id)
  }
})

// Create new post text field. Separate view to be able to bind events
App.CommentPostView = Ember.View.extend(Ember.TargetActionSupport, {
  click: function() {
    this.triggerAction();
  },

  // XXX: this is a dup of App.PartialPostView.toggleVisibility()
  // function. I just do not know how to access it from UI bindings
  toggleVisibility: function() {
    this.toggleProperty('parentView.isFormVisible');
  }
})

App.LikeView = Ember.View.extend({
  templateName: 'like-view',
  tagName: 'li',
  classNameBindings: ['isLastAndNotSingle:last', 'isFirstAndSingle:first'],
  classNames: ['pull-left'],

  isFirstAndSingle: function() {
    // NOTE: this is a hacky way to get updated content index -- when
    // element is removed from the observed array content indexes are
    // not updated yet, hence latest index could be bigger than total
    // number of elements in the collection. Same workarround is
    // applied in isLastAndNotSingle function below.

    //var index = this.get('contentIndex')+1

    var currentId = this.get('content.id')
    var index, i = 0
    this.get('_parentView.content').forEach(function(like) {
      if (like.id == currentId) { index = i; return; }
      i += 1
    })
    var length = this.get('parentView.content.length')
    return index === 0 && length === 1
  }.property('parentView', 'parentView.content.@each'),

  isLastAndNotSingle: function() {
    var currentId = this.get('content.id')
    var index, i = 1
    this.get('_parentView.content').forEach(function(like) {
      if (like.id == currentId) { index = i; return; }
      i += 1
    })
    var length = this.get('parentView.content.length')

    return index == length && length > 1
  }.property('parentView', 'parentView.content.@each')
});

App.CommentPostViewSubst = Ember.View.extend(Ember.TargetActionSupport, {
  classNameBindings: 'isVisible visible:invisible',

  click: function() {
    this.triggerAction();
  },

  // XXX: this is a dup of App.PartialPostView.toggleVisibility()
  // function. I just do not know how to access it from UI bindings
  toggleVisibility: function() {
    this.toggleProperty('parentView.isFormVisible');
  },

  // this method does not observe post comments as a result it won't
  // display additional Add comment link if user does not refresh the page
  isVisible: function() {
    var post = this.get('_context')
    var comments = post.comments || []

    if (comments.length < 4)
      return false

    // NOTE: though following approach is a nice once, FF implements
    // it differently -- just checks number of comments.

    // // return false if comments do not include current user
    // // var exist = post.createdBy.id == currentUser
    // var exist = false
    // comments.forEach(function(comment) {
    //   exist = exist || comment.createdBy.id == currentUser
    // })

    // // If user have not commented this post there is no need to
    // // display additional comment link at the bottom of the post.
    // if (!exist)
    //   return false

    return this.get('parentView.isFormVisible') === false;
  }.property('parentView.isFormVisible')
})

// Text field to post a comment. Separate view to make it hideable
App.CommentForm = Ember.View.extend({
  // I'd no success to use isVisibleBinding property...
  classNameBindings: 'isVisible visible:invisible',
  body: '',

  isVisible: function() {
    return this.get('parentView.isFormVisible') === true;
  }.property('parentView.isFormVisible'),

  autoFocus: function () {
    if (this.get('parentView.isFormVisible') === true) {
      this.$().hide().show();
      this.$('textarea').focus();
      this.$('textarea').trigger('keyup') // to apply autogrow
    }
  }.observes('parentView.isFormVisible'),

  submitComment: function() {
    if (this.body) {
      // XXX: rather strange bit of code here -- potentially a defect
      var post = this._context
      App.commentsController.createComment(post, this.body)
      this.set('parentView.isFormVisible', false)
      this.set('body', '')
    }
  },

  // XXX: this is a dup of App.PartialPostView.toggleVisibility()
  // function. I just do not know how to access it from UI bindings
  toggleVisibility: function() {
    this.toggleProperty('parentView.isFormVisible');
  },

  cancelComment: function() {
    this.set('parentView.isFormVisible', false)
    this.set('body', '')
  }
});

App.EditPostForm = Ember.View.extend({
  // I'd no success to use isVisibleBinding property...
  classNameBindings: 'isVisible visible:invisible',
  body: '',

  isVisible: function() {
    return this.get('parentView.isEditFormVisible') === true;
  }.property('parentView.isEditFormVisible'),

  autoFocus: function () {
    if (this.get('parentView.isEditFormVisible') === true) {
      this.$().hide().show();
      this.$('textarea').focus();
      this.$('textarea').trigger('keyup') // to apply autogrow
    }
  }.observes('parentView.isEditFormVisible'),

  // XXX: this is a dup of App.PartialPostView.toggleVisibility()
  // function. I just do not know how to access it from UI bindings
  toggleVisibility: function() {
    this.toggleProperty('parentView.isEditFormVisible');
  }
});

App.EditCommentForm = Ember.View.extend({
  body: '',

  autoFocus: function () {
    if (this.get('parentView.isEditFormVisible') === true) {
      this.$().hide().show();
      this.$('textarea').focus();
      this.$('textarea').trigger('keyup') // to apply autogrow
    }
  }.observes('parentView.isEditFormVisible'),

  // FIXME: autoFocus doesn't observe isEditFormVisible?
  didInsertElement: function() {
    this.autoFocus()
  },

  updateComment: function() {
    if (this.body) {
      // XXX: rather strange bit of code here -- potentially a defect
      var comment = this._context
      App.commentsController.updateComment(comment, this.body)
      this.set('parentView.isEditFormVisible', false)
      this.set('body', '')
    }
  },

  // XXX: this is a dup of App.PartialPostView.toggleVisibility()
  // function. I just do not know how to access it from UI bindings
  editFormVisibility: function() {
    this.toggleProperty('parentView.isEditFormVisible');
  }
});


// Create new post text field. Separate view to be able to bind events
App.CreateCommentView = Ember.TextArea.extend(Ember.TargetActionSupport, {
  attributeBindings: ['class'],
  classNames: ['autogrow-short'],
  rows: 1,

  insertNewline: function() {
    this.triggerAction();
  },

  didInsertElement: function() {
    // FIXME: bind as valueBinding property
    if (this.action != 'submitComment')
      this.set('value', this._context.body)

    this.$().autogrow();
  }
})

// Separate page for a single post
App.PostController = Ember.ObjectController.extend({
  update: function(attrs) {
    // FIXME: the only way to fetch context after insertNewLine action
    if (attrs.constructor === App.EditPostForm ||
       attrs.constructor === App.CreatePostView)
      attrs = { body: attrs.value }

    var postId = this.get('id')

    App.Post.update(postId, attrs)

    // FIXME: move this code back to view
    //if (attrs.body) {
    //  this.set('parentView.isEditFormVisible', false)
    //}
  },

  like: function() {
    var postId = this.get('content.id')
    App.Post.like(postId)
  },

  unlike: function() {
    var postId = this.get('content.id')
    App.Post.unlike(postId)
  },

  destroy: function() {
    var postId = this.get('content.id')
    App.Post.destroy(postId)
  }
})

App.PostView = Ember.View.extend({
  templateName: 'post',
  isFormVisible: false,
  isEditFormVisible: false,
  currentUser: currentUser,

  toggleVisibility: function() {
    this.toggleProperty('isFormVisible');
  },

  editFormVisibility: function() {
    this.toggleProperty('isEditFormVisible');
  },

  groupsNames: function() {
    if (!this.get("controller.content.groups") ||
        this.get("controller.content.createdBy.username") ==
        this.get("controller.content.groups.username")) {
      return null;
    }

    return this.get("controller.content.groups.username");
  }.property('controller.content', 'App.postsController.user'),

  didInsertElement: function() {
    if (this.$()) {
      // TODO: replace to boundhelpers
      // wrap anchor tags around links in comments
      this.$().find('.body').anchorTextUrls();
      // wrap hashtags around text in post text
      this.$().find('.body').hashTagsUrls();
    }
  },

  postLoaded: function() {
    // TODO: WTF! Replace to boundHelpers
    Ember.run.next(this, function() {
      if (this.$()) {
        this.$().find('.body').anchorTextUrls()
        this.$().find('.body').hashTagsUrls()
      }
    })
  }.observes('controller.content'),

  postOwner: function() {
    return this.get("controller.content.createdBy") &&
      this.get("controller.content.createdBy.id") == App.properties.userId;
  }.property('controller.content')
});

App.UserTimelineController = Ember.ObjectController.extend({
  resourceUrl: '/v1/timeline',

  subscribeTo: function(timelineId) {
    $.ajax({
      url: this.resourceUrl + '/' + timelineId + '/subscribe',
      context: this,
      type: 'post',
      success: function(response) {
        if (response.status == 'success') {
          if (App.postsController.user.type == 'group')
            // TODO: how to add an object to existing view?
            App.groupsController.addObject(App.postsController.user.get('username'))

          this.transitionToRoute('posts')
        }
      }
    })
  },

  unsubscribeTo: function(timelineId) {
    $.ajax({
      url: this.resourceUrl + '/' + timelineId + '/unsubscribe',
      context: this,
      type: 'post',
      success: function(response) {
        if (response.status == 'success') {
          if (App.postsController.user.type == 'group')
            // TODO: how to remove an object to existing view?
            App.groupsController.removeObject(App.postsController.user.get('username'))

          this.transitionToRoute('posts')
        }
      }
    })
  }
});
App.userTimelineController = App.UserTimelineController.create()

App.UserTimelineView = Ember.View.extend({
  templateName: 'user-timeline',
  currentUser: currentUser,

  showPostCreationForm: function() {
    return this.get("controller.user") &&
      (((this.get("controller.user.type") == 'user' || !this.get("controller.user.type")) &&
        this.get("controller.user.id") == currentUser) ||
       (this.get("controller.user.type") === 'group' && this.get("controller.subscribers").filter(function(subscriber) {
         return subscriber.id == currentUser;
       })));
  }.property('controller.user'),

  isGroup: function() {
    return this.get("controller.user") && this.get("controller.user.type") == 'group';
  }.property('controller.user'),

  subscribeTo: function() {
    App.userTimelineController.subscribeTo(this.get("controller.id"));
  },

  unsubscribeTo: function() {
    App.userTimelineController.unsubscribeTo(this.get("controller.id"));
  },

  subscribedTo: function() {
    var res = false;
    var subscribers = this.get("controller.subscribers");

    if (!subscribers) return res;

    for (var i = 0; i < subscribers.length; i++) {
      if (subscribers[i].id == currentUser) {
        res = true;
        break;
      }
    }

    return res;
  }.property("controller.subscribers.@each.id", "currentUser"),

  ownProfile: function() {
    return this.get("controller.user.id") == currentUser;
  }.property("currentUser", "controller.user.id"),

  submitPost: function() {
    this.set('controller.receiveTimelinesIds', [ this.get('controller.id') ]);
    this.get("controller").submitPost();
    // dirty way to restore original height of post textarea
    this.$().find('textarea').height('56px')
  }
})

App.Comment = Ember.Object.extend({
  body: null,
  createdAt: null,
  user: null
});

App.Subscriber = Ember.Object.extend({
  id: null,
  username: null,
  isAdmin: null
})

App.User = Ember.Object.extend({
  id: null,
  username: null,
  createdAt: null,
  updatedAt: null,
  statistics: {},
  admins: [],
  type: null,

  subscriptionsLength: function() {
    if (!this.statistics || !this.statistics.subscriptions || this.statistics.subscriptions <= 0)
      return null

    return this.statistics.subscriptions
  }.property(),

  subscribersLength: function() {
    if (!this.statistics || !this.statistics.subscribers || this.statistics.subscribers <= 0)
      return null

    return this.statistics.subscribers
  }.property(),

  postsLength: function() {
    if (!this.statistics || !this.statistics.posts || this.statistics.posts <= 0)
      return null

    return this.statistics.posts
  }.property(),

  commentsLength: function() {
    if (!this.statistics || !this.statistics.discussions || this.statistics.discussions <= 0)
      return null

    return this.statistics.discussions
  }.property(),

  likesLength: function() {
    if (!this.statistics || !this.statistics.likes || this.statistics.likes <= 0)
      return null

    return this.statistics.likes
  }.property(),

  subscribedTo: function() {
    // TODO: review this code as this models *depends* on
    // postsController for misterious reasons
    if (!App.postsController.subscribers)
      return false

    var subscribed = App.postsController.subscribers.filter(function(subscriber) {
      return subscriber.id == App.properties.get('userId')
    })
    return subscribed.length > 0 ? true : false
  }.property(),

  ownProfile: function() {
    return App.postsController.user.id == currentUser
  }.property()
})

App.CommentsController = Ember.ObjectController.extend({
  resourceUrl: '/v1/comments',

  // XXX: noone uses this method
  removeComment: function(propName, value) {
    var obj = this.findProperty(propName, value);
    this.removeObject(obj);
  },

  destroyComment: function(commentId) {
    $.ajax({
      url: this.resourceUrl + '/' + commentId,
      type: 'post',
      data: {'_method': 'delete'},
      success: function(response) {
        console.log(response)
      }
    })
  },

  updateComment: function(comment, body) {
    $.ajax({
      url: this.resourceUrl + '/' + comment.id,
      type: 'post',
      data: { body: body, '_method': 'patch' },
      context: comment,
      success: function(response) {
        console.log(response)
      }
    })
  },

 createComment: function(post, body) {
    var comment = App.Comment.create({ 
      body: body,
      postId: post.id
    });
    
    $.ajax({
      url: this.resourceUrl,
      type: 'post',
      data: { body: body, postId: post.id }, // XXX: we've already defined a model above
      context: comment,
      success: function(response) {
        this.setProperties(response);
        // We do not insert comment right now, but wait for a socket event
        // post.comments.pushObject(comment)
      }
    })
    return comment;
  }
})
App.commentsController = App.CommentsController.create()

App.Timeline = Ember.Object.extend({
  posts: Ember.ArrayProxy.createWithMixins(Ember.SortableMixin, {
    // TODO: figure out why we have to add itemController="post"
    // option to each iterator in the view
    itemController: 'post',

    content: [],

    sortProperties: ['updatedAt'],
    sortAscending: false
  })
})

App.Timeline.reopenClass({
  resourceUrl: '/v1/timeline',

  find: function(timelineId, options) {
    if (timelineId === undefined) timelineId = ''

    var timeline = App.Timeline.create()

    $.ajax({
      url: this.resourceUrl + '/' + timelineId || '',
//      data: { start: pageStart },
      dataType: 'jsonp',
      context: this
    }).then(function(response) {
      if (response.posts)
        response.posts.forEach(function(attrs) {
          var post = App.Post.create(attrs)
          timeline.posts.addObject(post)
        })

      delete response.posts
      timeline.setProperties(response)
    })
    return timeline
  }
})

App.TimelineController = Ember.ObjectController.extend(App.PaginationHelper, {
  resourceUrl: '/v1/posts',

  isLoaded: true,
  isProgressBarHidden: 'hidden',
  body: '',

  // XXX: a bit strange having this method here?
  submitPost: function() {
    if (this.body) {
      this.createPost(this.body);
      this.set('body', '')
      //this.set('receiveTimelinesIds', [])
    }
  },

  createPost: function(body) {
    var that = this

    var data = new FormData();
    $.each($('input[type="file"]')[0].files, function(i, file) {
      // TODO: can do this just once outside of the loop
      App.postsController.set('isProgressBarHidden', 'visible')
      data.append('file-'+i, file);
    });
    data.append('body', $('.submitForm textarea')[0].value) // XXX: dirty!
    // data.append('timelinesIds', this.get('receiveTimelinesIds').toString()) // XXX: dirty!

    var xhr = new XMLHttpRequest();

    // Progress listerner.
    xhr.upload.addEventListener("progress", function (evt) {

      if (evt.lengthComputable) {
        var percentComplete = Math.round(evt.loaded * 100 / evt.total);
        that.set('progress', percentComplete)
      } else {
        // unable to compute
      }
    }, false);

    // On finished.
    xhr.addEventListener("load", function (evt) {
      // Clear file field
      var control = $('input[type="file"]')
      control.replaceWith( control.val('').clone( true ) );
      $('.file-input-name').html('')

      // var obj = $.parseJSON(evt.target.responseText);
      // TODO: bind properties
      that.set('progress', '100')
      that.set('isProgressBarHidden', 'hidden')
    }, false);

    // On failed.
    xhr.addEventListener("error", function (evt) {
      that.set('isProgressBarHidden', 'hidden')
    }, false);

    // On cancel.
    xhr.addEventListener("abort", function (evt) {
      that.set('isProgressBarHidden', 'hidden')
    }, false);

    xhr.open("post", this.get('resourceUrl'));
    xhr.send(data);

    // fallback to simple ajax if xhr is not supported
    // $.ajax({
    //   url: this.resourceUrl,
    //   type: 'post',
    //   data: data,
    //   cache: false,
    //   contentType: false,
    //   processData: false,
    //   context: post,
    //   success: function(response) {
    //     this.setProperties(response);
    //     this.attachment = null
    //     this.loading = false
    //     // We do not insert post right now, but wait for a socket event
    //     // App.postsController.insertAt(0, post)
    //   }
    // })
  }
})

App.Post = Ember.Object.extend({
  showAllComments: false,
  currentUser: currentUser,
  comments: Ember.ArrayProxy.create(),

  partial: function() {
    if (this.showAllComments)
      return false
    else
      return this.comments && this.get('comments').length > 3
  }.property('showAllComments', 'comments'),

  removeLike: function(propName, value) {
    var obj = this.get('likes').findProperty(propName, value);
    this.likes.removeObject(obj);
  },

  postOwner: function() {
    return this.get('createdBy').id == currentUser &&
      this.get('createdBy').username != 'anonymous'
  }.property('createdBy'),

  currentUserLiked: function() {
    var likes = this.get('likes')

    // XXX: we have just tried to render a view but have not recevied
    // anything from the server yet. Ideally we have to wait for this
    if (!likes) return;

    var found = false
    likes.forEach(function(like) {
      if (like.id == currentUser) {
        found = true
        return found;
      }
    })
    return found
  }.property('likes', 'likes.@each'),

  anyLikes: function() {
    var likes = this.get('likes')

    // XXX: we have just tried to render a view but have not recevied
    // anything from the server yet. Ideally we have to wait for this
    if (!likes) return;

    return likes.length > 0
  }.property('likes', 'likes.@each'),

  createdAgo: function() {
    if (this.get('createdAt')) {
      return moment(this.get('createdAt')).fromNow();
    }
  }.property('createdAt'),

  firstComment: function() {
    return this.get('comments')[0]
  }.property('comments'),

  lastComment: function() {
    var comments = this.get('comments')
    return comments[comments.length-1]
  }.property('comments', 'comments.@each'),

  skippedCommentsLength: function() {
    return this.get('comments').length-2 // display first and last comments only
  }.property('comments', 'comments.@each'),

  firstThumbnailSrc: function() {
    if (this.get('attachments') && this.get('attachments')[0]) {
      return this.get('attachments')[0].thumbnail.path;
    } else {
      return false
    }
  }.property('attachments'),

  firstImageSrc: function() {
    if (this.get('attachments') && this.get('attachments')[0]) {
      return this.get('attachments')[0].path;
    } else {
      return false
    }
  }.property('attachments')
});

App.Post.reopenClass({
  resourceUrl: '/v1/posts',

  update: function(postId, attrs) {
    $.ajax({
      url: this.resourceUrl + '/' + postId,
      type: 'post',
      data: { body: attrs.body, '_method': 'patch' },
      success: function(response) {
        console.log(response)
      }
    })
  },

  like: function(postId) {
    $.ajax({
      url: this.resourceUrl + '/' + postId + '/like',
      type: 'post',
      success: function(response) {
        console.log(response)
      }
    })
  },

  unlike: function(postId) {
    $.ajax({
      url: this.resourceUrl + '/' + postId + '/unlike',
      type: 'post',
      success: function(response) {
        console.log(response)
      }
    })
  },

  findOne: function(postId) {
    var post = App.Post.create();

    $.ajax({
      url: this.resourceUrl + '/' + postId,
      dataType: 'jsonp',
      success: function(response) {
        post.setProperties(response);
      },
      error: function(XMLHttpRequest, textStatus, errorThrown) {
        //if (errorThrown == 'Not Found')
        //  that.transitionToRoute('error')
      }
    })
    return post;
  },

  destroy: function(postId) {
    $.ajax({
      url: this.resourceUrl + '/' + postId,
      type: 'post',
      data: {'_method': 'delete'},
      success: function(response) {
        console.log(response)
      }
    })
  }
})

App.SearchController = Ember.ArrayController.extend(Ember.SortableMixin, App.PaginationHelper, {
  resourceUrl: '/v1/search',
  body: '',
  content: [],
  sortProperties: ['updatedAt'],
  query: '',

  sortAscending: false,
  isLoaded: true,

  insertPostsIntoMediaList : function(posts) {
//    App.properties.get('subscription').unsubscribe();

    App.searchController.set('content', []);
    var postIds = [];
    posts.forEach(function(attrs) {
      var post = App.Post.create(attrs);
      App.searchController.addObject(post);
      postIds.push(post.id)
    })

//    App.properties.get('subscription').subscribe('post', postIds);
    App.searchController.set('isLoaded', true)
  },

  showPage: function(pageStart) {
    this.set('isLoaded', false)
    var query = decodeURIComponent(this.get('query'));

    $.ajax({
      url: this.resourceUrl + '/' + query,
      type: 'get',
      data: { start: pageStart },
      success: function(response) {
        App.searchController.insertPostsIntoMediaList(response.posts);
      }
    });
  },

  searchByPhrase: function(searchQuery) {
    this.set('isLoaded', false)
    if (searchQuery) {
      if (/#/g.test(searchQuery))
        searchQuery = searchQuery.replace(/#/g, '%23')

      $.ajax({
        url: this.resourceUrl + '/' + searchQuery,
        type: 'get',
        success: function(response) {
          App.searchController.insertPostsIntoMediaList(response.posts);
        }
      });
      this.set('body', '');
    }
  },

  didRequestRange: function(pageStart) {
    App.searchController.showPage(pageStart)
  }
})
App.searchController = App.SearchController.create()

App.SubscriptionsController = Ember.ArrayController.extend({
  resourceUrl: '/v1/users',
  verb: 'subscriptions',

  findAll: function(username) {
    var filterSubscriptionsByUsername = function(subscriptions) {
      var filteredSubscriptions = []
      $.each(subscriptions, function(number, subscription) {
        if (subscription.name == 'Posts')
          filteredSubscriptions.push(subscription)
      })

      return filteredSubscriptions
    }

    this.set('isLoaded', false)

    $.ajax({
      url: this.resourceUrl + '/' + username + '/' + this.verb,
      dataType: 'jsonp',
      context: this,
      success: function(response) {
//        App.properties.get('subscription').unsubscribe()

        this.set('content', filterSubscriptionsByUsername(response))
        this.set('username', username)

        this.set('isLoaded', true)
      }
    })
    return this
  }
})
App.subscriptionsController = App.SubscriptionsController.create()

App.SubscriptionsView = Ember.View.extend({
  templateName: 'subscriptions'
});

App.ErrorController = Ember.ArrayController.extend({
})

App.ErrorView = Ember.View.extend({
  templateName: 'error'
});

App.SubscribersController = Ember.ArrayController.extend({
  resourceUrl: '/v1/users',
  verb: 'subscribers',

  findAll: function(username) {
    this.set('isLoaded', false)

    $.ajax({
      url: this.resourceUrl + '/' + username + '/' + this.verb,
      dataType: 'jsonp',
      context: this,
      success: function(response) {
//        App.properties.get('subscription').unsubscribe()

        this.set('content', [])
        response.subscribers.forEach(function(attrs) {
          if (response.admins)
            attrs.isAdmin = response.admins.indexOf(attrs.id) != -1

          var subscriber = App.Subscriber.create(attrs)
          this.addObject(subscriber)
        }, this)

        this.set('username', username)
        this.set('admins', response.admins)

        this.set('isLoaded', true)
      }
    })
    return this
  },

  removeSubscriber: function(event) {
    $.ajax({
      url: this.resourceUrl + '/' + this.get('username') + '/subscribers/' + event,
      dataType: 'jsonp',
      type: 'post',
      data: {'_method': 'delete'},
      context: this,
      success: function(response) {
        if (response.status == 'success') {
          var obj = this.findProperty('id', event);
          this.removeObject(obj);
        }
      }
    })

    return this
  },

  addAdmin: function(event) {
    $.ajax({
      url: this.resourceUrl + '/' + this.get('username') + '/subscribers/' + event + '/admin',
      dataType: 'jsonp',
      type: 'post',
      context: this,
      success: function(response) {
        if (response.status == 'success') {
          var obj = this.findProperty('id', event);
          if (obj) obj.set('isAdmin', true)
        }
      }
    })

    return this
  },

  removeAdmin: function(event) {
    $.ajax({
      url: this.resourceUrl + '/' + this.get('username') + '/subscribers/' + event + '/unadmin',
      dataType: 'jsonp',
      type: 'post',
      context: this,
      success: function(response) {
        if (response.status == 'success') {
          var obj = this.findProperty('id', event);
          if (obj) obj.set('isAdmin', false)
        }
      }
    })

    return this
  }
})
App.subscribersController = App.SubscribersController.create()

App.SubscribersView = Ember.View.extend({
  templateName: 'subscribers',

  isOwner: function() {
    return App.subscribersController.username == App.properties.username ||
      App.subscribersController.admins && App.subscribersController.admins.indexOf(currentUser) !== -1
  }.property('App.subscribersController.username', 'App.properties.username', 'App.subscribersController.admins'),

  hasAdmins: function() {
    return App.subscribersController.admins !== undefined
  }.property('App.subscribersController.admins'),

  showManagement: function() {
    return App.properties.get('currentPath') === 'manageSubscribers'
  }.property('App.properties.currentPath')
});

App.TopController = Ember.ArrayController.extend({
  resourceUrl: '/v1/top',

  getTop: function(category) {
    this.set('isLoaded', false)

    $.ajax({
      url: this.resourceUrl + '/' + category,
      dataType: 'jsonp',
      context: this,
      success: function(response) {
//        App.properties.get('subscription').unsubscribe()

        this.set('content', response)
        this.set('category', category)

        this.set('isLoaded', true)
      }
    })
    return this
  }
})
App.topController = App.TopController.create()

App.TopView = Ember.View.extend({
  templateName: 'top-view'
});

App.SignupController = Ember.ObjectController.extend({
  resourceUrl: '/v1/signup',
  username: '',
  password: '',

  signup: function() {
    $.ajax({
      url: this.resourceUrl,
      data: { username: this.get('username'), password: this.get('password') },
      dataType: 'jsonp',
      type: 'post',
      context: this,
      success: function(response) {
        switch (response.status) {
        case 'success':
          App.properties.set('isAuthorized', true)
          App.properties.set('username', response.user.username)
          App.properties.set('userId', response.user.id)
          this.transitionToRoute('posts')
          break
        case 'fail':
          this.transitionToRoute('signup')
          break
        }
      }
    })
    return this
  }
})
App.signupController = App.SignupController.create()

App.SignupView = Ember.View.extend({
  templateName: 'signup',

  insertNewline: function() {
    this.triggerAction();
  },

  signup: function() {
    this.get('controller').signup()
  }
});

App.SigninController = Ember.ObjectController.extend({
  resourceUrl: '/v1/session',
  username: '',
  password: '',

  signin: function() {
    var that = this;

    $.ajax({
      url: this.resourceUrl,
      data: { username: this.get('username'), password: this.get('password') },
      dataType: 'jsonp',
      type: 'post',
      context: this,
      success: function(response) {
        switch (response.status) {
        case 'success':
          App.properties.set('isAuthorized', true)
          App.properties.set('username', response.user.username)
          App.properties.set('userId', response.user.id)
          App.Group.findAll()
          this.transitionToRoute('posts')
          break
        case 'fail':
          that.transitionToRoute('signin')
          break
        }
      }
    })
    return this
  }
})

App.SigninView = Ember.View.extend({
  templateName: 'signin',

  insertNewline: function() {
    this.triggerAction();
  }
});

// TODO: this controller to be removed due to TimelineController
App.PostsController = Ember.ArrayController.extend(Ember.SortableMixin, App.PaginationHelper, {
  didRequestRange: function(pageStart) {
    App.postsController.findAll(pageStart)
  },

  didTimelineChange: function() {
    // NOTE: this method might be called even when we have not
    // initialized subscription property
//    if (App.properties.get('subscription'))
//      App.properties.get('subscription').unsubscribe()

    this.resetPage()
  }.observes('timeline')
})

App.HomeRoute = Ember.Route.extend({
  deactivate: function() {
    this.controllerFor('comet').unsubscribe()
  },

  model: function() {
    return App.Timeline.find()
  },

  setupController: function(controller, model) {
    this.controllerFor('groups').set('content', App.Group.findAll())
    this.controllerFor('tags').set('content', App.Tag.findAll())
    this.controllerFor('timeline').set('content', model)

    this.controllerFor('comet').set('channel', model)
  },

  renderTemplate: function() {
    this.render('timeline')
  }
})

App.PostRoute = Ember.Route.extend({
  deactivate: function() {
    this.controllerFor('comet').unsubscribe()
  },

  model: function(params) {
    return App.Post.findOne(params.post_id)
  },

  setupController: function(controller, model) {
    this.controllerFor('groups').set('content', App.Group.findAll())
    this.controllerFor('tags').set('content', App.Tag.findAll())
    controller.set('content', model);

    this.controllerFor('comet').set('channel', model)
  }
})

App.PublicRoute = Ember.Route.extend({
  deactivate: function() {
    this.controllerFor('comet').unsubscribe()
  },

  model: function() {
    return App.Timeline.find('everyone')
  },

  setupController: function(controller, model) {
    this.controllerFor('groups').set('content', App.Group.findAll())
    this.controllerFor('tags').set('content', App.Tag.findAll())
    this.controllerFor('timeline').set('content', model)

    this.controllerFor('comet').set('channel', model)
  },

  renderTemplate: function() {
    this.render('timeline')
  }
})

App.GroupsRoute = Ember.Route.extend({
  renderTemplate: function() {
    this.render('create-group', {
      controller: 'groups'
    })
  }
})

// TODO: actually this route doesn't render a user profile, but its
// posts instead, sounds like a wrong design and better'd be to use
// PostsRoute instead
App.UserRoute = Ember.Route.extend({
  model: function(params) {
    return params.username
  },

  setupController: function(controller, model) {
    App.userTimelineController.set('target', controller.target)
    this.controllerFor('timeline').set('content', App.Timeline.find(model));
  },

  renderTemplate: function() {
    this.render('user-timeline', {
      controller: this.controllerFor('timeline')
    })
  }
})

App.LikesRoute = Ember.Route.extend({
  model: function(params) {
    return params.username
  },

  setupController: function(controller, model) {
    // TODO: findAll method to accept timeline parameter
    App.postsController.set('timeline', model)
    var posts = App.postsController.findAll(0, 'likes')
    this.controllerFor('posts').set('content', posts);
  },

  renderTemplate: function() {
    this.render('user-timeline', {
      controller: this.controllerFor('posts')
    })
  }
})

App.CommentsRoute = Ember.Route.extend({
  model: function(params) {
    return params.username
  },

  setupController: function(controller, model) {
    // TODO: findAll method to accept timeline parameter
    App.postsController.set('timeline', model)
    var posts = App.postsController.findAll(0, 'comments')
    this.controllerFor('posts').set('content', posts);
  },

  renderTemplate: function() {
    this.render('user-timeline', {
      controller: this.controllerFor('posts')
    })
  }
})

App.FeedSubscribersRoute = Ember.Route.extend({
  model: function(params) {
    return params.username
  },

  setupController: function(controller, model) {
    var subscribers = App.subscribersController.findAll(model)
    this.controllerFor('subscribers').set('content', subscribers);
  },

  renderTemplate: function() {
    this.render('subscribers', {
      controller: this.controllerFor('subscribers')
    })
  }
})

App.ManageSubscribersRoute = Ember.Route.extend({
  model: function(params) {
    return params.username
  },

  setupController: function(controller, model) {
    var subscribers = App.subscribersController.findAll(model)
    this.controllerFor('subscribers').set('content', subscribers);
  },

  renderTemplate: function() {
    this.render('subscribers', {
      controller: this.controllerFor('subscribers')
    })
  }
})

App.FeedSubscriptionsRoute = Ember.Route.extend({
  model: function(params) {
    return params.username
  },

  setupController: function(controller, model) {
    if (typeof model !== 'string') model = model.username

    var subscriptions = App.subscriptionsController.findAll(model)
    this.controllerFor('subscriptions').set('content', subscriptions);
  },

  renderTemplate: function() {
    this.render('subscriptions', {
      controller: this.controllerFor('subscriptions')
    })
  }
})

App.FeedSearchRoute = Ember.Route.extend({
  model: function(params) {
    return decodeURIComponent(params.query)
  },

  setupController: function(controller, model) {
    // TODO: extract these side effects below to a controller or
    // something
    App.searchController.set('body', model)
    App.searchController.set('query', model)
    App.postsController.set('user', null)

    var posts = App.searchController.searchByPhrase(model)

    this.controllerFor('search').set('content', posts);
  },

  renderTemplate: function() {
    this.render('search-list-view')
  }
})

App.ErrorRoute = Ember.Route.extend({
})

App.StatsRoute = Ember.Route.extend({
  model: function(params) {
    return params.category
  },

  setupController: function(controller, model) {
    if (typeof model !== 'string') model = model.category

    var users = App.topController.getTop(model);

    this.controllerFor('top').set('content', users);
  },

  renderTemplate: function() {
    this.render('top-view', {
      controller: this.controllerFor('top')
    })
  }
})

App.Router.map(function() {
  this.resource('feedSearch', { path: "/search/:query" })

  this.resource('public', { path: "/public" })
  // NOTE: rather weird name for a river of news route
  this.resource('home', { path: "/" })
  this.resource('post', { path: "/posts/:post_id" })

  this.resource('user', { path: "/users/:username" })
  this.resource('feedSubscribers', { path: "/users/:username/subscribers" })
  this.resource('manageSubscribers', { path: "/users/:username/subscribers/manage" }) // TODO
  this.resource('feedSubscriptions', { path: "/users/:username/subscriptions" })
  this.resource('likes', { path: "/users/:username/likes" })
  this.resource('comments', { path: "/users/:username/comments" })

  this.resource('groups', { path: "/groups" })

  this.resource('signup', { path: "/signup" })
  this.resource('signin', { path: "/signin" })

  this.resource('stats', { path: "/top/:category" })

  this.resource('error', { path: "/error" })
});

(function() {
  var get = Ember.get, set = Ember.set;
  var popstateFired = false;
  Ember.HistoryJsLocation = Ember.Object.extend({
    init: function() {
      set(this, 'location', get(this, 'location') || window.location);
      this._initialUrl = this.getURL();
      this.initState();
    },
    initState: function() {
      this.replaceState(this.formatURL(this.getURL()));
      set(this, 'history', window.History);
    },
    rootURL: '/',
    getURL: function() {
      var rootURL = get(this, 'rootURL'),
      url = get(this, 'location').pathname;
      rootURL = rootURL.replace(/\/$/, '');
      url = url.replace(rootURL, '');
      return url;
    },
    setURL: function(path) {
      path = this.formatURL(path);
      if (this.getState() && this.getState().path !== path) {
        this.pushState(path);
      }
    },
    replaceURL: function(path) {
      path = this.formatURL(path);
      if (this.getState() && this.getState().path !== path) {
        this.replaceState(path);
      }
    },
    getState: function() {
      return get(this, 'history').getState().data;
    },
    pushState: function(path) {
      History.pushState({ path: path }, null, path);
    },
    replaceState: function(path) {
      History.replaceState({ path: path }, null, path);
    },
    onUpdateURL: function(callback) {
      var guid = Ember.guidFor(this),
      self = this;
      Ember.$(window).bind('popstate.ember-location-'+guid, function(e) {
        if(!popstateFired) {
          popstateFired = true;
          if (self.getURL() === self._initialUrl) { return; }
        }
        callback(self.getURL());
      });
    },
    formatURL: function(url) {
      var rootURL = get(this, 'rootURL');
      if (url !== '') {
        rootURL = rootURL.replace(/\/$/, '');
      }
      return rootURL + url;
    },
    willDestroy: function() {
      var guid = Ember.guidFor(this);
      Ember.$(window).unbind('popstate.ember-location-'+guid);
    }
  });
  Ember.Location.registerImplementation('historyJs', Ember.HistoryJsLocation);
})();

// NOTE: history.js (particularly replaceState method) replaces
// encoded URLs like %23 to # which break search by tag functionality.
App.Router.reopen({
  location: $.browser && $.browser.msie ? 'historyJs' : 'history'
});

Ember.Handlebars.registerBoundHelper('decodeURIComponent', function(content) {
  return decodeURIComponent(content)
})
