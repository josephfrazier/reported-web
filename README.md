# Reported-Web

A web front-end for [Reported](https://twitter.com/Reported_NYC).

## Install

Install [Node](https://nodejs.org/) and [Yarn](https://yarnpkg.com/), then run the following:

```bash
git clone https://github.com/josephfrazier/Reported-Web reported-web
cd reported-web
yarn
cp .env.example .env
```

## Run

In one session, load variables from `.env` into your environment, then:

```bash
yarn mongo-start
yarn parse
```

In another session:

```bash
yarn start
```

Miscellaneous commands:

```bash
yarn dashboard # Runs a dashboard for the Parse server
yarn mongo-stop # Stops MongoDB
```

## Context on `localStorage` use (w.r.t performance concerns about lag/delay/slowness/latency when typing)

Over the years, reports of slow typing have come from multiple users, and it periodically gets (re)discussed in our Slack.
Since our Slack currently doesn't preserve old messages, I often find myself re-investigating the issue and re-typing previous responses.
This section is meant to provide more central and permanent documentation of these investigations.
I think it's solved as of 8 February 2026, with commits 834b055234b6b62e58e890684c923d500780198e and 8c6d124a57eb42e486693239f315a1f50231ddf8
(https://github.com/josephfrazier/reported-web/pull/676 and https://github.com/josephfrazier/reported-web/pull/677)
but I'll leave it here for a bit just in case it comes up again.

<details>

For example: here's one of my posts from a conversation from July 2023 where this came up: https://reportedcab.slack.com/archives/C9VNM3DL4/p1690221553212389?thread_ts=1690137347.880569&cid=C9VNM3DL4

> hey y'all, "happy" to see it's not just Rich Mintz and Justin with this issue,
> that makes it easier to investigate. As @Justin found, this does seem to
> have to do with the webapp's use of localStorage to save the form's state
> locally.
>
> [The original intent of this change](https://github.com/josephfrazier/reported-web/commit/4ad4c316aeb2d8a8e7bc8eb8e462aa722ca56a3a) was to make it so that fields like your
> username/password and violation type would be saved across sessions, so
> that you don't have to log back in every time you open the website.
> However, it sounds like this may be storing more data than intended,
> possibly the "Previous Submissions" section as Rich mentioned.
>
> I'm hesitant to remove the use of localStorage entirely, as that could cause
> other issues like one that was previously reported when I [tried to stop using localStorage as much](https://github.com/josephfrazier/reported-web/pull/391),
> and led to [it being reintroduced](https://github.com/josephfrazier/reported-web/pull/394):
> > Not sure if this is an app problem or a me and my phone problem, but when I
> > am starting a report, then leave the tab or browser before I finish, it makes
> > me start all over from the login screen when I come back
>
> For reference, the [periodic saving of form state was added to fix a bug where
> "swiping away" the webapp (when installed as a "progressive web app" or PWA)
> didn't actually save the form state.](https://github.com/josephfrazier/reported-web/commit/4b22f2d957a08712e65cca065b2c11d7c384b47e)
>
> If the latency issues are indeed related to the number of previous submissions
> made, then hopefully I can make it so that those aren't part of the saved
> state, and speed things back up for our power users, without losing the upsides
> of keeping saved state across webapp loads.

> Hmm, looking into the localStorage usage, I currently only see the following
> fields being saved (specifically, not Previous Submissions), when I run
> `Object.keys(JSON.parse(localStorage.Function))`:
>
> ```
> [
>   "email",
>   "password",
>   "FirstName",
>   "LastName",
>   "Phone",
>   "testify",
>   "plate",
>   "licenseState",
>   "typeofcomplaint",
>   "reportDescription",
>   "can_be_shared_publicly",
>   "latitude",
>   "longitude",
>   "coordsAreInNyc",
>   "formatted_address",
>   "CreateDate",
>   "isAlprEnabled",
>   "isReverseGeocodingEnabled",
>   "isUserInfoOpen",
>   "isMapOpen"
> ]
> ```
>
> And the saved data is only 597 characters long, according to `localStorage.Function.length`
>
> Seth, Rich Mintz, Justin, and anyone else affected by this issue, could you run
> the above commands in your JS console, or find another way to tell me how big
> the `localStorage` usage of the webapp is?
>
> If clearing localStorage speeds things up for you, that makes me wonder if some
> browsers implement it in a way that gets slower over time, even though I
> believe the code overwrites any previously stored data, rather than appending
> to a list of "previous form states" or anything like that

Responses from Justin:

> `(20) ['email', 'password', 'FirstName', 'LastName', 'Phone', 'testify',
> 'plate', 'licenseState', 'typeofcomplaint', 'reportDescription',
> 'can_be_shared_publicly', 'latitude', 'longitude', 'coordsAreInNyc',
> 'formatted_address', 'CreateDate', 'isAlprEnabled',
> 'isReverseGeocodingEnabled', 'isUserInfoOpen', 'isMapOpen']`

> The issue reappears shortly after clearing the local storage. Can it just be caused by hammering the save every 500ms? Or maybe the debounce is broken and its saving more often?

> as a test, after clearing local storage
> * login
> * type something in the description box
> * refresh
> * typing in description box is now laggy

More debugging info from https://reportedcab.slack.com/archives/C9VNM3DL4/p1690233028016149?thread_ts=1690137347.880569&cid=C9VNM3DL4:

> > My next step might be to add some profiling in to make it clearer how long each save is taking
> 
> **TL;DR: I've made some good progress finding the source of the issue**
> 
> back on the code that uses localStorage, I'm doing some debugging locally on my
> MacOS desktop, and _I am able to reproduce the issue_ by typing quickly and
> seeing the letters not instantly appear!
> 
> I tried [removing just the auto-save behavior while keeping the other
> localStorage usage](https://github.com/josephfrazier/reported-web/commit/2bac6d970bf906885d88626c12d80c04d7d080ef) (mainly, loading the username/password/etc when the app is
> first loaded, but **that doesn't fix the problem**.
> 
> However, if I [go on to remove the localStorage usage entirely](https://github.com/josephfrazier/reported-web/compare/josephfrazier:091a41d...josephfrazier:9b99eee), **the problem goes
> away for me**, so it seems like the problem is indeed in the localStorage code,
> but not necessarily the auto-saving part of it.

and https://reportedcab.slack.com/archives/C9VNM3DL4/p1690235477916519?thread_ts=1690137347.880569&cid=C9VNM3DL4:

> back to the debugging, I tried [adding a bunch of logging to the React
> component that uses localstorage](https://github.com/josephfrazier/react-localstorage/compare/josephfrazier:f10d44b...josephfrazier:7f9673e), to see if it was being called even without
> the auto-saving behavior in the webapp, but I don't see any extra logs in the
> console when typing in the description field, so now I'm thinking that
> something about the component itself being present in the React component
> tree is causing the slowness
> 
> ![image](https://github.com/josephfrazier/reported-web/assets/6473925/e5713d97-2fd3-4c1d-a4ea-3cfded5b0f23)

We've managed to work around the problem by not loading Previous Submissions until clicked on, see https://reportedcab.slack.com/archives/C9VNM3DL4/p1690318259649319?thread_ts=1690137347.880569&cid=C9VNM3DL4:

> ok, it's definitely related to the presence of the Previous
> Submissions section, as I've found by removing it and seeing performance
> go back to normal: https://github.com/josephfrazier/reported-web/commit/884365086c56d8af001290eebda9c644a58a0ee5

> Interesting! Does it vary with number of previous submissions? Could explain
> why it’s gotten worse for me over time

> yeah, I think it must. Still don't know why it affects the performance
> of saving the state, but I can make it so that the Previous Submissions
> don't load until you expand the section, which works around the problem
> for me in that I can type quickly as long as I don't expand that
> section, but it's still available to me if I want it

On 8 February 2026, Claude Code helped me fix the performance issue with commits 834b055234b6b62e58e890684c923d500780198e and 8c6d124a57eb42e486693239f315a1f50231ddf8
(https://github.com/josephfrazier/reported-web/pull/676 and https://github.com/josephfrazier/reported-web/pull/677)
so hopefully that will be the end of this saga.

</details>

---

This project is based on [React Starter Kit](https://github.com/kriasoft/react-starter-kit). See its README below:

<details><summary>React Starter Kit README</summary>

## React Starter Kit — "[isomorphic](http://nerds.airbnb.com/isomorphic-javascript-future-web-apps/)" web app boilerplate &nbsp; <a href="https://github.com/kriasoft/react-starter-kit/stargazers"><img src="https://img.shields.io/github/stars/kriasoft/react-starter-kit.svg?style=social&label=Star&maxAge=3600" height="20"></a> <a href="https://twitter.com/ReactStarter"><img src="https://img.shields.io/twitter/follow/ReactStarter.svg?style=social&label=Follow&maxAge=3600" height="20"></a>

[React Starter Kit](https://www.reactstarterkit.com) is an opinionated boilerplate for web
development built on top of [Node.js](https://nodejs.org/),
[Express](http://expressjs.com/), [GraphQL](http://graphql.org/) and
[React](https://facebook.github.io/react/), containing modern web development
tools such as [Webpack](http://webpack.github.io/), [Babel](http://babeljs.io/)
and [Browsersync](http://www.browsersync.io/). Helping you to stay productive
following the best practices. A solid starting point for both professionals
and newcomers to the industry.

**See** [getting started guide](./docs/getting-started.md), [demo][demo],
[docs](https://github.com/kriasoft/react-starter-kit/tree/master/docs),
[roadmap](https://github.com/kriasoft/react-starter-kit/projects/1) &nbsp;|&nbsp;
**Join** [#react-starter-kit][chat] chat room on Gitter &nbsp;|&nbsp;
**Visit our sponsors**:<br><br>

<p align="center" align="top">
  <a href="https://rollbar.com/?utm_source=reactstartkit(github)&amp;utm_medium=link&amp;utm_campaign=reactstartkit(github)"><img src="https://koistya.github.io/files/rollbar-362x72.png" height="36" align="top" /></a>
  <a href="https://x-team.com/hire-react-developers/?utm_source=reactstarterkit&amp;utm_medium=github-link&amp;utm_campaign=reactstarterkit-june"><img src="https://koistya.github.io/files/xteam-255x72.png" height="36" align="top" /></a>
  <sup><a href="https://x-team.com/join/?utm_source=reactstarterkit&utm_medium=github-link&utm_campaign=reactstarterkit-june">Hiring</a></sup>
</p>

### Getting Started

- Follow the [getting started guide](./docs/getting-started.md) to download and run the project
  ([Node.js](https://nodejs.org/) >= 6.9)
- Check the [code recipes](./docs/recipes) used in this boilerplate, or share yours

### Customization

The `master` branch of React Starter Kit doesn't include a Flux implementation or any other
advanced integrations. Nevertheless, we have some integrations available to you in _feature_
branches that you can use either as a reference or merge into your project:

- [feature/redux](https://github.com/kriasoft/react-starter-kit/tree/feature/redux) ([PR](https://github.com/kriasoft/react-starter-kit/pull/1084))
  — isomorphic Redux by [Pavel Lang](https://github.com/langpavel)
  (see [how to integrate Redux](./docs/recipes/how-to-integrate-redux.md)) (based on `master`)
- [feature/apollo](https://github.com/kriasoft/react-starter-kit/tree/feature/apollo) ([PR](https://github.com/kriasoft/react-starter-kit/pull/1147))
  — isomorphic Apollo Client by [Pavel Lang](https://github.com/langpavel)
  (see [Tracking PR #1147](https://github.com/kriasoft/react-starter-kit/pull/1147)) (based on `feature/redux`)
- [feature/react-intl](https://github.com/kriasoft/react-starter-kit/tree/feature/react-intl) ([PR](https://github.com/kriasoft/react-starter-kit/pull/1135))
  — isomorphic Redux and React Intl by [Pavel Lang](https://github.com/langpavel)
  (see [how to integrate React Intl](./docs/recipes/how-to-integrate-react-intl.md)) (based on `feature/apollo`)
- [feature/apollo-pure](https://github.com/kriasoft/react-starter-kit/tree/feature/apollo-pure) ([PR](https://github.com/kriasoft/react-starter-kit/pull/1664))
  — bare Apollo codebase by [piglovesyou](https://github.com/piglovesyou) (based on `master`)

You can see status of most reasonable merge combination as [PRs labeled as `TRACKING`](https://github.com/kriasoft/react-starter-kit/labels/TRACKING)

If you think that any of these features should be on `master`, or vice versa, some features should
removed from the `master` branch, please [let us know](https://gitter.im/kriasoft/react-starter-kit).
We love your feedback!

### Comparison

<table width="100%">
  <tr>
    <th>&nbsp;</th>
    <th>
      <p>React Starter Kit</p>
      <a href="https://github.com/kriasoft/react-starter-kit"><img src="https://img.shields.io/github/stars/kriasoft/react-starter-kit.svg?style=social&label=~react-starter-kit" height="20"></a>
      <a href="https://twitter.com/ReactStarter"><img src="https://img.shields.io/twitter/follow/ReactStarter.svg?style=social&label=@ReactStarter" height="20"></a>
    </th>
    <th>
      <p>React Static Boilerplate</p>
      <a href="https://github.com/kriasoft/react-static-boilerplate"><img src="https://img.shields.io/github/stars/kriasoft/react-static-boilerplate.svg?style=social&label=~react-static-boilerplate" height="20"></a>
      <a href="https://twitter.com/ReactStatic"><img src="https://img.shields.io/twitter/follow/ReactStatic.svg?style=social&label=@ReactStatic" height="20"></a>
    </th>
    <th>
      <p>ASP.NET Core Starter Kit</p>
      <a href="https://github.com/kriasoft/aspnet-starter-kit"><img src="https://img.shields.io/github/stars/kriasoft/aspnet-starter-kit.svg?style=social&label=~aspnet-starter-kit" height="20"></a>
      <a href="https://twitter.com/dotnetreact"><img src="https://img.shields.io/twitter/follow/dotnetreact.svg?style=social&label=@dotnetreact" height="20"></a>
    </th>
  <tr>
  <tr>
    <th align="right">App type</th>
    <td align="center"><a href="http://nerds.airbnb.com/isomorphic-javascript-future-web-apps/">Isomorphic</a> (universal)</td>
    <td align="center"><a href="https://en.wikipedia.org/wiki/Single-page_application">Single-page application</a></td>
    <td align="center"><a href="https://en.wikipedia.org/wiki/Single-page_application">Single-page application</a></td>
  </tr>
  <tr>
    <th colspan="4">Frontend</th>
  <tr>
  <tr>
    <th align="right">Language</th>
    <td align="center">JavaScript (ES2015+, JSX)</td>
    <td align="center">JavaScript (ES2015+, JSX)</td>
    <td align="center">JavaScript (ES2015+, JSX)</td>
  </tr>
  <tr>
    <th align="right">Libraries</th>
    <td align="center">
      <a href="https://github.com/facebook/react">React</a>,
      <a href="https://github.com/ReactJSTraining/history">History</a>,
      <a href="https://github.com/kriasoft/universal-router">Universal Router</a>
    </td>
    <td align="center">
      <a href="https://github.com/facebook/react">React</a>,
      <a href="https://github.com/ReactJSTraining/history">History</a>,
      <a href="https://github.com/reactjs/redux">Redux</a>
    </td>
    <td align="center">
      <a href="https://github.com/facebook/react">React</a>,
      <a href="https://github.com/ReactJSTraining/history">History</a>,
      <a href="https://github.com/reactjs/redux">Redux</a>
    </td>
  </tr>
  <tr>
    <th align="right">Routes</th>
    <td align="center">Imperative (functional)</td>
    <td align="center">Declarative</td>
    <td align="center">Declarative, cross-stack</td>
  </tr>
  <tr>
    <th colspan="4">Backend</th>
  <tr>
  <tr>
    <th align="right">Language</th>
    <td align="center">JavaScript (ES2015+, JSX)</td>
    <td align="center">n/a</td>
    <td align="center">C#, F#</td>
  </tr>
  <tr>
    <th align="right">Libraries</th>
    <td align="center">
      <a href="https://nodejs.org">Node.js</a>,
      <a href="http://expressjs.com/">Express</a>,
      <a href="http://docs.sequelizejs.com/en/latest/">Sequelize</a>,<br>
      <a href="https://github.com/graphql/graphql-js">GraphQL</a></td>
    <td align="center">n/a</td>
    <td align="center">
      <a href="https://docs.asp.net/en/latest/">ASP.NET Core</a>,
      <a href="https://ef.readthedocs.io/en/latest/">EF Core</a>,<br>
      <a href="https://docs.asp.net/en/latest/security/authentication/identity.html">ASP.NET Identity</a>
    </td>
  </tr>
  <tr>
    <th align="right"><a href="https://www.quora.com/What-are-the-tradeoffs-of-client-side-rendering-vs-server-side-rendering">SSR</a></th>
    <td align="center">Yes</td>
    <td align="center">n/a</td>
    <td align="center">n/a</td>
  </tr>
  <tr>
    <th align="right">Data API</th>
    <td align="center"><a href="http://graphql.org/">GraphQL</a></td>
    <td align="center">n/a</td>
    <td align="center"><a href="https://docs.asp.net/en/latest/tutorials/first-web-api.html">Web API</a></td>
  </tr>
</table>

### Backers

♥ React Starter Kit? Help us keep it alive by donating funds to cover project
expenses via [OpenCollective](https://opencollective.com/react-starter-kit) or
[Bountysource](https://salt.bountysource.com/teams/react-starter-kit)!

<a href="http://www.nekst.me/" target="_blank" title="lehneres">
  <img src="https://github.com/lehneres.png?size=64" width="64" height="64" alt="lehneres">
</a>
<a href="http://www.vidpanel.com/" target="_blank" title="Tarkan Anlar">
  <img src="https://github.com/tarkanlar.png?size=64" width="64" height="64" alt="Tarkan Anlar">
</a>
<a href="https://morten.olsen.io/" target="_blank" title="Morten Olsen">
  <img src="https://github.com/mortenolsendk.png?size=64" width="64" height="64" alt="Morten Olsen">
</a>
<a href="https://twitter.com/adamthomann" target="_blank" title="Adam">
  <img src="https://github.com/athomann.png?size=64" width="64" height="64" alt="Adam">
</a>
<a href="http://dsernst.com/" target="_blank" title="David Ernst">
  <img src="https://github.com/dsernst.png?size=64" width="64" height="64" alt="David Ernst">
</a>
<a href="http://zanehitchcox.com/" target="_blank" title="Zane Hitchcox">
  <img src="https://github.com/zwhitchcox.png?size=64" width="64" height="64" alt="Zane Hitchcox">
</a>
<a href="https://opencollective.com/react-starter-kit" target="_blank">
  <img src="https://opencollective.com/static/images/become_backer.svg" width="64" height="64" alt="">
</a>

### How to Contribute

Anyone and everyone is welcome to [contribute](CONTRIBUTING.md) to this project. The best way to
start is by checking our [open issues](https://github.com/kriasoft/react-starter-kit/issues),
[submit a new issue](https://github.com/kriasoft/react-starter-kit/issues/new?labels=bug) or
[feature request](https://github.com/kriasoft/react-starter-kit/issues/new?labels=enhancement),
participate in discussions, upvote or downvote the issues you like or dislike, send [pull
requests](CONTRIBUTING.md#pull-requests).

### Learn More

- [Getting Started with React.js](http://facebook.github.io/react/)
- [Getting Started with GraphQL and Relay](https://quip.com/oLxzA1gTsJsE)
- [React.js Questions on StackOverflow](http://stackoverflow.com/questions/tagged/reactjs)
- [React.js Discussion Board](https://discuss.reactjs.org/)
- [Flux Architecture for Building User Interfaces](http://facebook.github.io/flux/)
- [Enzyme — JavaScript Testing utilities for React](http://airbnb.io/enzyme/)
- [Flow — A static type checker for JavaScript](http://flowtype.org/)
- [The Future of React](https://github.com/reactjs/react-future)
- [Learn ES6](https://babeljs.io/docs/learn-es6/), [ES6 Features](https://github.com/lukehoban/es6features#readme)

### Related Projects

- [GraphQL Starter Kit](https://github.com/kriasoft/graphql-starter-kit) — Boilerplate for building data APIs with Node.js, JavaScript (via Babel) and GraphQL
- [Membership Database](https://github.com/membership/membership.db) — SQL schema boilerplate for user accounts, profiles, roles, and auth claims
- [Babel Starter Kit](https://github.com/kriasoft/babel-starter-kit) — Boilerplate for authoring JavaScript/React.js libraries

### Support

- [#react-starter-kit](http://stackoverflow.com/questions/tagged/react-starter-kit) on Stack Overflow — Questions and answers
- [#react-starter-kit](https://gitter.im/kriasoft/react-starter-kit) on Gitter — Watch announcements, share ideas and feedback
- [GitHub issues](https://github.com/kriasoft/react-starter-kit/issues), or [Scrum board](https://waffle.io/kriasoft/react-starter-kit) — File issues, send feature requests
- [appear.in/react](https://appear.in/react) — Open hours! Exchange ideas and experiences (React, GraphQL, startups and pet projects)
- [@koistya](https://twitter.com/koistya) on [Codementor](https://www.codementor.io/koistya), or [Skype](http://hatscripts.com/addskype?koistya) — Private consulting

### License

Copyright © 2014-present Kriasoft, LLC. This source code is licensed under the MIT
license found in the [LICENSE.txt](https://github.com/kriasoft/react-starter-kit/blob/master/LICENSE.txt)
file. The documentation to the project is licensed under the
[CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) license.

---

Made with ♥ by Konstantin Tarkus ([@koistya](https://twitter.com/koistya)) and [contributors](https://github.com/kriasoft/react-starter-kit/graphs/contributors)

[rsk]: https://www.reactstarterkit.com
[demo]: http://demo.reactstarterkit.com
[node]: https://nodejs.org
[chat]: https://gitter.im/kriasoft/react-starter-kit

</details>
