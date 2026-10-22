# Security Policy

## Scope

This repository is the HugMesh **admin console**: an Angular native-federation
remote loaded by the host shell. It renders the admin pages and calls the admin
BFF. It does not decide who may do what. The gateway and the BFFs enforce every
authorization check, so a page that is reachable here is still refused upstream
when the caller lacks the role.

Report issues in this console here, for example: script injection in a rendered
page, a page that leaks data it was given to the wrong viewer, unsafe handling of
a one-time secret such as an issued SSH private key, or a weak Content Security
Policy in the served image. Report a missing or wrong permission check against the
repository that enforces it (the gateway or the matching BFF).

## Supported versions

There is no maintenance branch. The supported version is the latest commit on
`main`. Fixes land on `main` and are not backported.

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting: open the
**Security** tab of this repository and choose **Report a vulnerability**. Do not
open a public issue or pull request for a vulnerability that is not fixed yet.

Include the affected commit, the steps to reproduce it and the impact you saw.
You will get an acknowledgement and a triage decision. Accepted reports are fixed
on `main`, and the reporter is told when the fix ships.
