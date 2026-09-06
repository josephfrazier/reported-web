import capitalize from 'capitalize';

// Format the `properties` of a Pelias reverse-geocoding result as a
// human-readable address. Some results have no housenumber (e.g. parks and
// NYCHA buildings come back as venues), so filter out missing parts instead
// of letting "undefined" show up in the formatted address.
export default function formatGeosearchAddress({
  housenumber,
  street,
  borough,
}) {
  const streetAddress = [housenumber, street].filter(Boolean).join(' ');
  return capitalize.words([streetAddress, borough].filter(Boolean).join(', '));
}
