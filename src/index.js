'use strict'

const googleMaps = require('@google/maps')
const querystring = require('querystring')
const sortOn = require('sort-on')

const enumerateWaypointSets = require('./rook.js')

module.exports = getBestWaypoints
module.exports.getMapsLink = getMapsLink

function getBestWaypoints ({origin, destination, waypointGrid, key, babyFoodStops, routeSortKey, memoizeFn}) {
  key = key || process.env.GOOGLE_MAPS_API_KEY
  babyFoodStops = babyFoodStops || []
  routeSortKey = routeSortKey || 'distance'
  memoizeFn = memoizeFn || (f => f)

  const waypointsSets = enumerateWaypointSets(waypointGrid).map(waypoints => waypoints.concat(babyFoodStops))
  // 50 is the max free rate limit, according to
  // https://developers.google.com/maps/documentation/directions/usage-limits
  // https://googlemaps.github.io/google-maps-services-js/docs/module-@google_maps.html#.createClient
  const googleMapsClient = googleMaps.createClient({key, Promise, rate: {limit: 50}})

  const routePromises = waypointsSets.map(function (waypoints) {
    const args = {origin, destination, waypoints, googleMapsClient}
    return Promise.resolve(memoizeFn(getOptimizedRoute)).then(f => f(args))
  })
  return Promise.all(routePromises).then(function (routeWaypointPairs) {
    // filter out routes that make a baby food stop first
    // TODO what if they all get filtered out? (see test/index.js TODO)
    routeWaypointPairs = routeWaypointPairs.filter(({waypoints}) => !babyFoodStops.includes(waypoints[0]))
    const routeKeyFunction = ({route}) => getLegsTotal({route, property: routeSortKey})
    const result = sortOn(routeWaypointPairs, routeKeyFunction)[0]
    return result
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

function getLegsTotal ({route, property}) {
  const values = route.legs.map(leg => leg[property].value)
  const sum = (a, b) => a + b
  const total = values.reduce(sum, 0)
  return total
}

function reorderWaypoints ({route, waypoints}) {
  return route.waypoint_order.map((index) => waypoints[index])
}

function getMapsLink ({origin, destination, waypoints}) {
  const allWaypoints = [origin].concat(waypoints).concat(destination)
  const escapedWaypoints = allWaypoints.map(querystring.escape).join('/')
  const dataString = '!4m2!4m1!3e1' // https://webapps.stackexchange.com/questions/67190/how-can-i-encode-my-preference-of-biking-walking-public-transport-in-a-google-ma/78800#78800
  return `https://www.google.com/maps/dir/${escapedWaypoints}/data=${dataString}`
}
