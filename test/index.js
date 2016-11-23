const test = require('tape')
const getBestWaypoints = require('../')

const origin = 'Hudson Yards Park'
const destination = '440 Grand St'

// https://farm3.static.flickr.com/2778/4134507221_d0c9ec1b7c_o.jpg
const grid = [
  ['221-225 8th Ave, 10011', '907 8th Ave, NYC', '289 Columbus Ave, NYC', '25 University Pl, NYC'],
  ['512 2nd Ave, NYC', '452 W 43rd St., NYC', '1407 Lexington Ave, NYC', '316 Greenwich St, NYC'],
  ['311 E 23rd St, NYC', '580 9th Ave, NYC', '2704 Broadway, NYC', '5 St. James Pl, NYC'],
  ['10 Union Sq. East, NYC', '225 W. 57th St, NYC', '609 Columbus Ave, NYC', '2217 7th Ave, NYC']
]

test('Cranksgiving 11 NYC (no baby food)', function (t) {
  t.plan(1)

  getBestWaypoints({
    origin,
    destination,
    waypointGrid: grid
  }).then(function ({route, waypoints}) {
    t.deepEqual(waypoints, [
      '907 8th Ave, NYC',
      '609 Columbus Ave, NYC',
      '512 2nd Ave, NYC',
      '5 St. James Pl, NYC'
    ])
  }).catch(() => t.fail)
})
