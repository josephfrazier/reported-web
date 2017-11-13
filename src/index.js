'use strict'

const googleMaps = require('@google/maps')
const makeUrlRequest = require('@google/maps/lib/internal/make-url-request.js')
const sortOn = require('sort-on')

const enumerateWaypointSets = require('./rook.js')

module.exports = getBestWaypoints
module.exports.getOptimizedRoutes = getOptimizedRoutes
module.exports.sortRoutesBy = sortRoutesBy
module.exports.getMapsLink = getMapsLink
module.exports.getLegsTotal = getLegsTotal
module.exports.testData = require('./testData')

// args is an object that looks like the arguments for `getOptimizedRoutes`
// It can also have a `routeSortKey` property ('distance' or 'duration')
function getBestWaypoints (args) {
  const routeSortKey = args.routeSortKey || 'distance'
  return getOptimizedRoutes(args).then(function (routeWaypointPairs) {
    return sortRoutesBy({routeWaypointPairs, routeSortKey})[0]
  })
}

function getOptimizedRoutes ({
    origin,
    destination,
    waypointGrid,
    waypointOptions,
    key = process.env.GOOGLE_MAPS_API_KEY,
    corsProxy = '',
    babyFoodStops = [],
    memoizeFn = (f => f)
  }) {
  const waypointsSets = enumerateWaypointSets(waypointGrid, waypointOptions).map(waypoints => waypoints.concat(babyFoodStops))
  // 50 is the max free rate limit, according to
  // https://developers.google.com/maps/documentation/directions/usage-limits
  // https://googlemaps.github.io/google-maps-services-js/docs/module-@google_maps.html#.createClient
  const googleMapsClient = googleMaps.createClient({
    key,
    Promise,
    rate: {
      limit: 50
    },
    makeUrlRequest: function (url, onSuccess, onError) {
      return makeUrlRequest(corsProxy + url, onSuccess, onError)
    }
  })

  const routePromises = waypointsSets.map(function (waypoints) {
    waypoints = waypoints.sort()
    const args = {origin, destination, waypoints, googleMapsClient}
    return Promise.resolve(memoizeFn(getOptimizedRoute)).then(f => f(args))
  })
  return Promise.all(routePromises).then(function (routeWaypointPairs) {
    // filter out routes that make a baby food stop first
    // TODO what if they all get filtered out? (see test/index.js TODO)
    return routeWaypointPairs.filter(({waypoints}) => !babyFoodStops.includes(waypoints[0]))
  })
}

function getOptimizedRoute ({origin, destination, waypoints, googleMapsClient}) {
  return googleMapsClient.directions({
    origin,
    destination,
    waypoints: 'optimize:true|' + waypoints.join('|'),
    mode: 'bicycling'
  }).asPromise().then(function (response) {
    const route = response.json.routes[0]
    return {
      route,
      waypoints: reorderWaypoints({route, waypoints})
    }
  })
}

function sortRoutesBy ({routeWaypointPairs, routeSortKey}) {
  const routeKeyFunction = ({route}) => getLegsTotal({route, property: routeSortKey})
  return sortOn(routeWaypointPairs, routeKeyFunction)
}

function getLegsTotal ({route, property}) {
  const values = route.legs.map(leg => leg[property].value)
  const sum = (a, b) => a + b
  const total = values.reduce(sum, 0)
  return total
}

function reorderWaypoints ({route, waypoints}) {
  return route.waypoint_order.map((index) => waypoints[index])
}

// https://stackoverflow.com/questions/2660201/what-parameters-should-i-use-in-a-google-maps-url-to-go-to-a-lat-lon/44859423#44859423
// https://developers.google.com/maps/documentation/urls/guide#directions-action
function getMapsLink ({origin, destination, waypoints}) {
  const joinedWaypoints = waypoints.join('|')

  return `https://www.google.com/maps/dir/?api=1&origin=${
    encodeURIComponent(origin)
  }&destination=${
    encodeURIComponent(destination)
  }&waypoints=${
    encodeURIComponent(joinedWaypoints)
  }&travelmode=bicycling`
}
