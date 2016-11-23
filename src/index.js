'use strict'

const googleMaps = require('@google/maps')
const querystring = require('querystring')

module.exports = getOptimizedRoute

function getOptimizedRoute ({origin, destination, waypoints, key}) {
  key = key || process.env.GOOGLE_MAPS_API_KEY

  const googleMapsClient = googleMaps.createClient({ key, Promise })

  return googleMapsClient.directions({
    origin,
    destination,
    waypoints: 'optimize:true|' + waypoints.join('|'),
    mode: 'bicycling'
  }).asPromise().then(response => response.json.routes[0])
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
const waypoints = ['Barossa Valley, SA', 'Clare, SA', 'Coonawarra, SA', 'McLaren Vale, SA']
const origin = 'Adelaide, SA'
const destination = origin

getOptimizedRoute({
  origin,
  destination,
  waypoints
}).then(function (route) {
  console.log(inspect(route, false, null))

  const reorderedWaypoints = reorderWaypoints({waypoints, route})
  console.log(reorderedWaypoints)
  console.log(getMapsLink({origin, destination, waypoints: reorderedWaypoints}))
})
