require('dotenv').config()

const test = require('tape')
const getBestWaypoints = require('../')
const cachePath = require('path').join(__dirname, '..', 'cache')
const memoize = require('memoize-fs')({ cachePath })

const memoizeFn = memoize.fn
const origin = 'Hudson Yards Park'
const destination = '440 Grand St'

// https://farm3.static.flickr.com/2778/4134507221_d0c9ec1b7c_o.jpg
const grid = [
  ['221-225 8th Ave, 10011', '907 8th Ave, NYC', '289 Columbus Ave, NYC', '25 University Pl, NYC'],
  ['512 2nd Ave, NYC', '452 W 43rd St., NYC', '1407 Lexington Ave, NYC', '316 Greenwich St, NYC'],
  ['311 E 23rd St, NYC', '580 9th Ave, NYC', '2704 Broadway, NYC', '5 St. James Pl, NYC'],
  ['10 Union Sq. East, NYC', '225 W. 57th St, NYC', '609 Columbus Ave, NYC', '2217 7th Ave, NYC']
]

const babyFoodStops = [ '441 West 26th St, NYC', '137 East 2nd St, NYC' ]

test('Cranksgiving 11 NYC (no baby food)', function (t) {
  t.plan(2)

  getBestWaypoints({
    memoizeFn,
    origin,
    destination,
    waypointGrid: grid
  }).then(function ({route, waypoints}) {
    const expected = [ '225 W. 57th St, NYC', '289 Columbus Ave, NYC', '512 2nd Ave, NYC', '5 St. James Pl, NYC' ]
    t.deepEqual(waypoints, expected)
    t.equal(
      getBestWaypoints.getMapsLink({origin, destination, waypoints}),
      getBestWaypoints.getMapsLink({origin, destination, waypoints: expected}),
    )
  }).catch(t.end)
})

test('baby food stops should not come first', function (t) {
  t.plan(2)

  getBestWaypoints({
    memoizeFn,
    origin,
    destination,
    waypointGrid: grid,
    // this is very slightly closer to the origin than is the first stop otherwise
    babyFoodStops: ['891 8th Ave, New York, NY 10019']
  }).then(function ({route, waypoints}) {
    const expected = [ '452 W 43rd St., NYC', '891 8th Ave, New York, NY 10019', '609 Columbus Ave, NYC', '221-225 8th Ave, 10011', '5 St. James Pl, NYC' ]
    t.deepEqual(waypoints, expected)
    // TODO this is not optimal. For example, here's the corresponding map:
    // https://goo.gl/maps/qgPt6hpN41u
    // but here is one that would be faster:
    // https://goo.gl/maps/rzZyuRgySTR2
    t.equal(
      getBestWaypoints.getMapsLink({origin, destination, waypoints}),
      getBestWaypoints.getMapsLink({origin, destination, waypoints: expected}),
    )
  }).catch(t.end)
})

test('Cranksgiving 11 NYC (w/ baby food) (sorted by distance)', function (t) {
  t.plan(2)

  getBestWaypoints({
    memoizeFn,
    origin,
    destination,
    waypointGrid: grid,
    babyFoodStops
  }).then(function ({route, waypoints}) {
    const expected = [ '452 W 43rd St., NYC', '289 Columbus Ave, NYC', '441 West 26th St, NYC', '10 Union Sq. East, NYC', '137 East 2nd St, NYC', '5 St. James Pl, NYC' ]
    t.deepEqual(waypoints, expected)
    t.equal(
      getBestWaypoints.getMapsLink({origin, destination, waypoints}),
      getBestWaypoints.getMapsLink({origin, destination, waypoints: expected}),
    )
  }).catch(t.end)
})

test('Cranksgiving 11 NYC (w/ baby food) (sorted by duration)', function (t) {
  t.plan(2)

  getBestWaypoints({
    memoizeFn,
    origin,
    destination,
    waypointGrid: grid,
    babyFoodStops,
    routeSortKey: 'duration'
  }).then(function ({route, waypoints}) {
    const expected = [ '225 W. 57th St, NYC', '289 Columbus Ave, NYC', '441 West 26th St, NYC', '512 2nd Ave, NYC', '137 East 2nd St, NYC', '5 St. James Pl, NYC' ]
    t.deepEqual(waypoints, expected)
    t.equal(
      getBestWaypoints.getMapsLink({origin, destination, waypoints}),
      getBestWaypoints.getMapsLink({origin, destination, waypoints: expected}),
    )
  }).catch(t.end)
})

test('Cranksgiving 11 NYC (w/o eliminating columns)', function (t) {
  t.plan(3)

  getBestWaypoints({
    memoizeFn,
    origin,
    destination,
    waypointGrid: grid,
    waypointOptions: {
      eliminateColumns: false
    }
  }).then(function ({route, waypoints}) {
    t.ok(getBestWaypoints.getLegsTotal({route, property: 'distance'}) < 16238, 'route is shorter without eliminating columns')
    const expected = [ '452 W 43rd St., NYC', '580 9th Ave, NYC', '221-225 8th Ave, 10011', '10 Union Sq. East, NYC' ]
    t.deepEqual(waypoints, expected)
    t.equal(
      getBestWaypoints.getMapsLink({origin, destination, waypoints}),
      getBestWaypoints.getMapsLink({origin, destination, waypoints: expected}),
    )
  }).catch(t.end)
})
