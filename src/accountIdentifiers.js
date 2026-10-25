// The values that identify one Parse account on its submissions.
//
// An account has two identifiers: the `username` it signed up with and its
// `email` address, and Parse Server's logIn matches either one (`$or` of the
// two). Submissions store the address the reporter typed, in their `Username`
// (and sometimes `email`) fields, and that address is not always the
// account's username: the mobile clients create accounts whose username is a
// different address at the same provider. Matching against the username
// alone therefore hides those reporters' own submissions from them, so both
// identifiers are used.
//
// The profile form's `useremail` field is deliberately not included: any
// client can set it on its own account through /saveUser, so matching by it
// would let an account claim another person's submissions.
const accountIdentifiers = user => [
  ...new Set([user.get('username'), user.get('email')].filter(Boolean)),
];

export default accountIdentifiers;
