# Security policy

## Reporting route

Private GitHub vulnerability reporting is currently disabled, and no verified
owner contact route has been supplied. Do not post credentials, tokens, or
secret values in public issues.

The repository owner must enable and verify a private reporting route, publish
the approved route here, and test its receipt before this policy can claim a
private disclosure channel. Until then, this is an owner-action blocker rather
than an invitation to disclose sensitive details publicly.

## Scope and handling

Report suspected credential exposure, dependency compromise, unsafe CI
privilege, artifact disclosure, and browser security defects through the
verified private route once available. Store only safe identifiers such as file,
line, rule, commit, and redacted finding ID in repository evidence.

On a plausible credential finding: stop publication, use the established
private owner route, rotate or revoke through authorised operators, and record
the rotation requirement without testing the credential or rewriting public
history.

Automated checks are evidence controls, not a guarantee that every
vulnerability or disclosure is found. GitHub settings, alert thresholds, and
deployment protection require separate owner verification.
