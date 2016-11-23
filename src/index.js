'use strict'

const googleMaps = require('@google/maps')
const querystring = require('querystring')
const sortOn = require('sort-on')

const enumerateWaypointSets = require('./rook.js')

module.exports = getBestWaypoints

function getBestWaypoints ({origin, destination, waypointGrid, key}) {
  key = key || process.env.GOOGLE_MAPS_API_KEY

  const waypointsSets = enumerateWaypointSets(waypointGrid)
  // 50 is the max free rate limit, according to
  // https://developers.google.com/maps/documentation/directions/usage-limits
  // https://googlemaps.github.io/google-maps-services-js/docs/module-@google_maps.html#.createClient
  const googleMapsClient = googleMaps.createClient({key, Promise, rate: {limit: 50}})

  // TODO don't slice. This is only to avoid hitting the API quota
  const routePromises = waypointsSets.slice(0, 10).map(function (waypoints) {
    const args = {origin, destination, waypoints, googleMapsClient}
    return getOptimizedRoute(args)
  })
  return Promise.all(routePromises).then(function (routeWaypointPairs) {
    const result = sortOn(routeWaypointPairs, ({route, waypoints}) => getTotalDistance(route))[0]
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

function getTotalDistance (route) {
  const distances = route.legs.map(leg => leg.distance.value)
  const sum = (a, b) => a + b
  const totalDistance = distances.reduce(sum, 0)
  return totalDistance
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

// //////

const inspect = require('util').inspect
const origin = 'Hudson Yards Park'
const destination = '440 Grand St'

getBestWaypoints({
  origin,
  destination,
  waypointGrid: enumerateWaypointSets.grid
}).then(function ({route, waypoints}) {
  console.log(inspect(route, false, null))
  console.log(waypoints)
  console.log(getMapsLink({origin, destination, waypoints}))
})
