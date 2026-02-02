/**
 * Server-side rendering middleware
 */

import React from 'react';
import ReactDOM from 'react-dom/server';
import PrettyError from 'pretty-error';

import App from '../components/App';
import Html from '../components/Html';
import { ErrorPageWithoutStyle } from '../routes/error/ErrorPage';
import errorPageStyle from '../routes/error/ErrorPage.css';
import createFetch from '../createFetch';
import router from '../router';
import config from '../config';

const pe = new PrettyError();
pe.skipNodeFiles();
pe.skipPackage('express');

/**
 * Register SSR middleware on Express app
 * @param {Object} app - Express app instance
 * @param {Object} options
 * @param {Function} options.nodeFetch - node-fetch function
 * @param {Object} options.chunks - Chunk manifest for code splitting
 */
export function registerSsrMiddleware(app, { nodeFetch, chunks }) {
  app.get('*', async (req, res, next) => {
    try {
      const css = new Set();

      // Enables critical path CSS rendering
      // https://github.com/kriasoft/isomorphic-style-loader
      const insertCss = (...styles) => {
        // eslint-disable-next-line no-underscore-dangle
        styles.forEach(style => css.add(style._getCss()));
      };

      // Universal HTTP client
      const fetch = createFetch(nodeFetch, {
        baseUrl: config.api.serverUrl,
        cookie: req.headers.cookie,
      });

      // Global (context) variables that can be easily accessed from any React component
      // https://facebook.github.io/react/docs/context.html
      const context = {
        insertCss,
        fetch,
        // The twins below are wild, be careful!
        pathname: req.path,
        query: req.query,
      };

      const route = await router.resolve(context);

      if (route.redirect) {
        res.redirect(route.status || 302, route.redirect);
        return;
      }

      const data = { ...route };
      data.children = ReactDOM.renderToString(
        <App context={context}>{route.component}</App>,
      );
      data.styles = [{ id: 'css', cssText: [...css].join('') }];

      const scripts = new Set();
      const addChunk = chunk => {
        if (chunks[chunk]) {
          chunks[chunk].forEach(asset => scripts.add(asset));
        } else if (__DEV__) {
          throw new Error(`Chunk with name '${chunk}' cannot be found`);
        }
      };
      addChunk('client');
      if (route.chunk) addChunk(route.chunk);
      if (route.chunks) route.chunks.forEach(addChunk);

      data.scripts = Array.from(scripts);
      data.app = {
        apiUrl: config.api.clientUrl,
      };

      const html = ReactDOM.renderToStaticMarkup(<Html {...data} />);
      res.status(route.status || 200);
      res.send(`<!doctype html>${html}`);
    } catch (err) {
      next(err);
    }
  });
}

/**
 * Register error handling middleware on Express app
 * @param {Object} app - Express app instance
 */
export function registerErrorMiddleware(app) {
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(pe.render(err));
    const html = ReactDOM.renderToStaticMarkup(
      <Html
        title="Internal Server Error"
        description={err.message}
        styles={[{ id: 'css', cssText: errorPageStyle._getCss() }]} // eslint-disable-line no-underscore-dangle
      >
        {ReactDOM.renderToString(<ErrorPageWithoutStyle error={err} />)}
      </Html>,
    );
    res.status(err.status || 500);
    res.send(`<!doctype html>${html}`);
  });
}
