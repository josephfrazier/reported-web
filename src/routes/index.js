/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

/* eslint-disable global-require */

// The top-level (parent) route
const routes = {
  path: '',

  // Keep in mind, routes are evaluated in order
  children: [
    {
      path: '',
      load: () => import(/* webpackChunkName: 'home' */ './home/index.js'),
    },
    {
      path: '/electricitibikes',
      load: () =>
        import(
          /* webpackChunkName: 'electricitibikes' */ './electricitibikes/index.js'
        ),
    },
    {
      path: '/login',
      load: () => import(/* webpackChunkName: 'login' */ './login/index.js'),
    },
    {
      path: '/register',
      load: () =>
        import(/* webpackChunkName: 'register' */ './register/index.js'),
    },
    {
      path: '/about',
      load: () => import(/* webpackChunkName: 'about' */ './about/index.js'),
    },
    {
      path: '/privacy',
      load: () =>
        import(/* webpackChunkName: 'privacy' */ './privacy/index.js'),
    },
    {
      path: '/admin',
      load: () => import(/* webpackChunkName: 'admin' */ './admin/index.js'),
    },

    // Wildcard routes, e.g. { path: '(.*)', ... } (must go last)
    {
      path: '(.*)',
      load: () =>
        import(/* webpackChunkName: 'not-found' */ './not-found/index.js'),
    },
  ],

  async action({ next }) {
    // Execute each child route until one of them return the result
    const route = await next();

    // Provide default values for title, description etc.
    route.title = route.title || 'Untitled Page';
    route.description = route.description || '';

    return route;
  },
};

// The error page is available by permanent url for development mode
if (__DEV__) {
  routes.children.unshift({
    path: '/error',
    action: require('./error/index.js').default,
  });
}

export default routes;
