require('dotenv').config()

const test = require('tape')
const getBestWaypoints = require('../')
const cachePath = require('path').join(__dirname, '..', 'cache')
const memoize = require('memoize-fs')({ cachePath })

const memoizeFn = memoize.fn
const origin = 'Hudson Yards Park, West 36th Street, New York, NY, United States'
const destination = `Saint Mary's Church, 440 Grand Street, New York, NY, United States`

// https://farm3.static.flickr.com/2778/4134507221_d0c9ec1b7c_o.jpg
const grid = [
  [
    `Gristede's Foods, 221 8th Avenue, New York, NY, United States`,
    `Gristedes, 907 8th Avenue, New York, NY, United States`,
    `Pioneer Supermarket, 289 Columbus Avenue, New York, NY, United States`,
    `Gristede's Foods, 25 University Place, New York, NY, United States`
  ],
  [
    `512 2nd Avenue, New York, NY, United States`,
    `Food Emporium, 452 W 43rd St, New York, NY, United States`,
    `Pioneer Supermarket, 1407 Lexington Avenue, New York, NY, United States`,
    `316 Greenwich Street, New York, NY, United States`
  ],
  [
    `Morton Williams Supermarkets, 311 E 23rd St, New York, NY, United States`,
    `580 9th Avenue, New York, NY, United States`,
    `2704 Broadway, New York, NY, United States`,
    `C-Town Supermarkets, 5 St James Pl, New York, NY, United States`
  ],
  [
    `The Food Emporium, 10 Union Square East, New York, NY, United States`,
    `225 West 57th Street, New York, NY, United States`,
    `609 Columbus Avenue, New York, NY, United States`,
    `2217 7th Avenue, New York, NY, United States`
  ]
]

const babyFoodStops = [
  `Hudson Guild, 441 West 26th Street, New York, NY, United States`,
  `137 East 2nd Street, New York, NY, United States`
]

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
