You are a senior DevOps and Platform Architect responsible for preparing this repository for long-term production maintenance.

Your objective is not simply to fix the current deployment issue. Your objective is to redesign and simplify the deployment architecture while remaining as close to upstream as reasonably possible.

I prefer a production-quality repository over minimal edits.

Context

This repository is a fork of Plane.

Over time the deployment files have become inconsistent.

There are multiple deployment approaches (root compose, CLI deployment, AIO deployment, custom HGN deployment, etc.) and they duplicate configuration, expose different environment variables, and have become difficult to maintain.

The current deployment issue involving the Caddy configuration exposed deeper architectural problems.

I have attached a deployment guide that represents the intended deployment architecture. Use it as a reference. If the guide is outdated, update the implementation to match the intended architecture and explain any differences.

Primary Goals

Redesign the deployment layer so it becomes:

clean
structured
modular
maintainable
production ready
easy to understand
easy to extend
easy to merge with upstream Plane in the future

Do not optimize only for making the application run.

Optimize for long-term maintainability.

Requirements

Perform a complete audit of every deployment-related component.

This includes, but is not limited to:

docker-compose.yml
docker-compose.override.yml
compose fragments
Dockerfiles
Caddy
nginx
deployment scripts
shell scripts
environment loading
startup scripts
health checks
proxy configuration
certificates
networking
volumes
reverse proxies
production configuration
development configuration
CLI deployment
AIO deployment
custom HGN deployment
Tasks

1. Audit

Identify

duplicated configuration
dead code
obsolete deployment files
unused Dockerfiles
unused compose files
deprecated scripts
broken environment variables
inconsistent configuration
conflicting deployment paths
files that should no longer exist

Explain why each item is obsolete.

2. Environment Variables

Audit every environment variable.

Determine

where it is defined
where it is consumed
whether it actually reaches the container
whether it is unused
whether defaults belong in Compose or the application

Produce a dependency map.

Pay special attention to

SITE_ADDRESS
CERT_EMAIL
CERT_ACME_CA
CERT_ACME_DNS
TRUSTED_PROXIES
FILE_SIZE_LIMIT
BUCKET_NAME 3. Simplify

Restructure the deployment so that

every deployment has one obvious entry point
configuration is centralized
duplicated configuration is removed
deployment-specific overrides are isolated
environment propagation is consistent

there is a clear separation between

base deployment

production deployment

development deployment

custom HGN deployment

4. Caddy

Audit the entire Caddy configuration.

Determine

whether snippets are used correctly
whether global options are correctly structured
whether environment variables are handled correctly
whether certificate configuration is correct
whether reverse proxy routing is optimal
whether the deployment matches current Caddy best practices

Do not keep unnecessary complexity.

5. Docker Compose

Normalize every compose file.

Avoid duplicated services.

Avoid duplicated environment blocks.

Avoid duplicated volume mappings.

Avoid duplicated networks.

Prefer reusable compose fragments where appropriate.

6. Remove Technical Debt

Delete deployment files that are no longer required.

Delete obsolete compose files.

Delete obsolete scripts.

Delete abandoned deployment approaches.

Delete dead configuration.

Do not leave "just in case" files.

Every remaining deployment file must have a purpose.

7. Preserve Upstream Compatibility

Whenever possible

avoid modifying upstream files unnecessarily
isolate HGN customizations
keep future upstream merges simple

If an upstream file must change, explain why.

8. Validation

After restructuring,

verify

docker compose config
docker compose up
container startup
Caddy validation
health checks
reverse proxy routing
API availability
frontend availability
MinIO routing
environment propagation

Do not assume success.

Verify it.

Deliverables

Produce

1.

A complete architecture report.

2.

A deployment tree showing the final structure.

3.

A list of every deleted file and why it was removed.

4.

A list of every modified file and why it changed.

5.

A dependency graph for deployment.

6.

A migration guide from the old deployment to the new deployment.

7.

An updated deployment guide reflecting the final architecture.

8.

A regression checklist verifying

startup
certificates
compose
networking
storage
environment variables
reverse proxy
API
frontend
Constraints
Do not make unnecessary application code changes.
Focus only on deployment, infrastructure, and configuration.
Favor clarity over cleverness.
Reduce file count where appropriate.
Remove duplication aggressively.
Explain every architectural decision.
If there are multiple valid approaches, compare them and justify the chosen design.
Do not stop after fixing the current error. Continue until the deployment architecture is internally consistent, minimal, and production-ready.
