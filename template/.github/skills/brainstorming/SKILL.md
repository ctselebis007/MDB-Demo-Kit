---
name: brainstorming
description: 'Brainstorm ideas into fully formed designs and specs through collaborative dialogue. Use when: starting a new demo or POC, designing a new module, exploring architecture or MongoDB feature options, turning a rough idea into a design doc, planning before implementation.'
argument-hint: 'Describe your demo, POC or module idea to brainstorm'
---

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

This project is a MongoDB Atlas demo built on the MongoDB Demo Kit. Designs must fit its module contract (see `.github/copilot-instructions.md`), so the result can be implemented as one or more modules.

## The Process

### Understanding the idea

- Check out the current project state first: `README.md`, `docs/plans/`, installed modules in `api/app/modules/` and `web/src/modules/`, recent commits
- Note whether this is a blank starter (no modules) or already has modules that could be extended or re-themed
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message — if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria
- For demos, also cover: the audience and industry, the story / "wow" moment, which MongoDB capabilities must be shown (Atlas Search, Vector Search, hybrid `$rankFusion`, reranking, `$graphLookup`, aggregation, change streams, …), and the shape and volume of synthetic data

### Exploring approaches

- Propose 2-3 different approaches with trade-offs
- Typical options: re-theme an installed kit module, extend one, or build a new module; one module vs. several
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

### Presenting the design

- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- For each module, map the design onto the contract:
  - **Demo flow** — pages, what the presenter clicks, what the audience sees
  - **Data** — collections, document shape, `seed.py` generation (deterministic, synthetic), `embed_fields`
  - **Indexes** — `indexes.py` regular, Atlas Search and Vector Search definitions
  - **Queries** — `pipelines.py` aggregation pipelines (shown in the Query Drawer)
  - **API** — `router.py` endpoints returning `QueryResponse`, guarded by `require_ready`
  - **UI** — `web/src/modules/<name>/` route, nav item, components
- Be ready to go back and clarify if something doesn't make sense

## After the Design

### Documentation

- Write the validated design to `docs/plans/YYYY-MM-DD-<topic>-design.md`
- Write clearly and concisely — prefer short sentences, active voice, no jargon
- Commit the design document to git

### Implementation (if continuing)

- Ask: "Ready to set up for implementation?"
- Write `docs/plans/YYYY-MM-DD-<topic>-implementation.md` with a table of discrete tasks: ID, task, depends on, how it is tested
- Break the plan into small, testable steps, typically: seed data → indexes → pipelines (unit tests) → router (route tests) → UI (Vitest) → Setup flow check (Test Connections, Seed, Create Indexes) → demo walkthrough
- Each task must keep `npm test`, `npm run lint` and `npm run typecheck` green

## Key Principles

- **One question at a time** — Don't overwhelm with multiple questions
- **Multiple choice preferred** — Easier to answer than open-ended when possible
- **YAGNI ruthlessly** — Remove unnecessary features from all designs
- **Explore alternatives** — Always propose 2-3 approaches before settling
- **Incremental validation** — Present design in sections, validate each
- **Be flexible** — Go back and clarify when something doesn't make sense
- **Synthetic data only** — Never copy real customer data into seed data, docs or commits
