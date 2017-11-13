require('dotenv').config()

const test = require('tape')
const getBestWaypoints = require('../')
const cachePath = require('path').join(__dirname, '..', 'cache')
const memoize = require('memoize-fs')({ cachePath })

const memoizeFn = memoize.fn
const {
  origin,
  destination,
  grid,
  babyFoodStops
} = getBestWaypoints.testData

test('Cranksgiving 11 NYC (no baby food)', function (t) {
  t.plan(2)

  getBestWaypoints({
    memoizeFn,
    origin,
    destination,
    waypointGrid: grid
  }).then(function ({route, waypoints}) {
    const expected = [ grid[3][1], grid[0][2], grid[1][0], grid[2][3] ]
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
    const expected = [ grid[1][1], '891 8th Ave, New York, NY 10019', grid[0][2], grid[3][0], grid[2][3] ]
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
    const expected = [ grid[1][1], grid[0][2], babyFoodStops[0], grid[3][0], babyFoodStops[1], grid[2][3] ]
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
    const expected = [ grid[3][1], grid[0][2], babyFoodStops[0], grid[1][0], babyFoodStops[1], grid[2][3] ]
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
    const expected = [ grid[1][1], grid[2][1], grid[0][0], grid[3][0] ]
    t.deepEqual(waypoints, expected)
    t.equal(
      getBestWaypoints.getMapsLink({origin, destination, waypoints}),
      getBestWaypoints.getMapsLink({origin, destination, waypoints: expected}),
    )
  }).catch(t.end)
})
