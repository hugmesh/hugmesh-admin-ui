# HugMesh admin-ui — local dev targets.
#
# `make pentest` mirrors the centralized CI pen-test stage (.gitlab-ci.yml ->
# generator /tests/pentest/ci/pentest-stage.gitlab-ci.yml) so you can self-scan
# before pushing. It runs the repo-local SCA self-scan and, when a target URL is
# set, delegates the full DAST harness to the generator's run-pentest.sh.
#
# Knobs:
#   DAST_TARGET_URL   when set, run the DAST harness against this URL.
#   PENTEST_HARNESS   path to a checked-out generator harness (tests/pentest dir);
#                     defaults to ../snapdragon-generator/tests/pentest, else the
#                     harness is shallow-cloned into .pentest-harness.
#   DC_IMAGE          dependency-check image (CI uses owasp/dependency-check).

SHELL := /bin/bash
DAST_TARGET_URL ?=
PENTEST_HARNESS ?= ../snapdragon-generator/tests/pentest
DC_IMAGE ?= owasp/dependency-check:latest

.PHONY: pentest pentest-sca pentest-dast

# Full local pen-test: SCA self-scan, then DAST (only if a target URL is set).
pentest: pentest-sca pentest-dast

# SCA — Angular repo self-scan. Primary: `npm audit` (mirrors the CI SCA gate at
# high severity). Optional deeper scan: OWASP Dependency-Check via docker, which
# is exactly what the centralized .pentest-sca CI job runs. Never hard-fails the
# make run on missing tooling — surfaces findings and moves on.
pentest-sca:
	@echo "==> [SCA] npm audit (--audit-level=high), mirrors CI SCA gate"
	@if [ -f package-lock.json ]; then \
		npm audit --audit-level=high || echo "   (npm audit reported findings — review above)"; \
	else \
		echo "   (no package-lock.json — run 'npm install' first; skipping npm audit)"; \
	fi
	@echo "==> [SCA] OWASP Dependency-Check (optional, the CI source of truth)"
	@if command -v docker >/dev/null 2>&1; then \
		mkdir -p reports/sca; \
		docker run --rm -v "$(CURDIR):/src:ro" -v "$(CURDIR)/reports/sca:/report" \
			$(DC_IMAGE) --scan /src --project "hugmesh-admin-ui" \
			--out /report --enableExperimental --format HTML --format JSON \
			|| echo "   (dependency-check reported findings/errors — review reports/sca/)"; \
	else \
		echo "   (docker not available — skipping Dependency-Check; CI runs it via $(DC_IMAGE))"; \
	fi

# DAST — delegate the FULL harness (ZAP baseline + custom probes + nuclei) to the
# generator's run-pentest.sh, exactly like the centralized .pentest-dast-baseline
# CI job. No-op (with a hint) when DAST_TARGET_URL is unset so `make pentest` is
# safe to run with no target.
pentest-dast:
	@if [ -z "$(DAST_TARGET_URL)" ]; then \
		echo "==> [DAST] DAST_TARGET_URL not set — skipping DAST harness."; \
		echo "    Set DAST_TARGET_URL=https://host to run the full harness, e.g.:"; \
		echo "      make pentest DAST_TARGET_URL=https://admin.localhost"; \
		exit 0; \
	fi; \
	HARNESS="$(PENTEST_HARNESS)"; \
	if [ ! -f "$$HARNESS/run-pentest.sh" ]; then \
		echo "==> [DAST] harness not found at $$HARNESS — shallow-cloning generator"; \
		rm -rf .pentest-harness; \
		git clone --depth 1 --branch main \
			https://github.com/Snapdragon-Systems/snapdragon-generator.git .pentest-harness \
			&& HARNESS=".pentest-harness/tests/pentest"; \
	fi; \
	if [ -f "$$HARNESS/run-pentest.sh" ]; then \
		echo "==> [DAST] bash $$HARNESS/run-pentest.sh --env compose --scan baseline --pipeline main"; \
		DAST_TARGET_URL="$(DAST_TARGET_URL)" bash "$$HARNESS/run-pentest.sh" \
			--env compose --scan baseline --pipeline main \
			|| echo "   (DAST harness reported findings/errors — review out/pentest/)"; \
	else \
		echo "   (could not obtain run-pentest.sh — set PENTEST_HARNESS to a generator checkout)"; \
	fi
