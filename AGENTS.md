# Model Routing

Choose the model and reasoning effort based on task complexity.

## 1. Very Complex — GPT-5.6 Sol / Max

Use **GPT-5.6 Sol with maximum reasoning effort** for:

- System architecture
- Designing a new major feature
- Large multi-file refactoring
- Complex debugging
- Difficult performance problems
- Database architecture/migrations
- Authentication/authorization design
- Security-sensitive changes
- Distributed systems
- Complex algorithms
- Understanding unfamiliar or large parts of the codebase
- Problems where multiple architectural approaches must be evaluated

Prioritize deep reasoning and correctness over speed.

---

## 2. Complex Implementation — GPT-5.6 Sol / XHigh

Use **GPT-5.6 Sol with xhigh reasoning effort** for:

- Implementing complex features from an existing plan
- Multi-file changes
- Backend + frontend changes together
- Complex API integrations
- Complex database operations
- Significant refactoring
- Difficult bug fixes
- Writing important production code
- Changes that could cause regressions

Inspect the existing implementation carefully before making changes.

---

## 3. Normal Development — GPT-5.6 Terra / Medium

Use **GPT-5.6 Terra with medium reasoning effort** for:

- Normal feature implementation
- Standard API endpoints
- React/React Native components
- CRUD functionality
- Forms
- Normal database queries
- Unit/integration tests
- Standard refactoring
- Routine debugging
- Adding straightforward functionality

Prefer this for normal development to avoid unnecessarily using the most expensive reasoning level.

---

## 4. Simple Tasks — GPT-5.6 Luna / Low

Use **GPT-5.6 Luna with low reasoning effort** for:

- Small code changes
- Renaming variables/functions
- Simple bug fixes
- Simple UI changes
- Formatting
- Boilerplate
- Documentation updates
- Simple configuration changes
- Straightforward code generation

Optimize for speed.

---

## 5. Code Review — GPT-5.6 Sol / High

Use **GPT-5.6 Sol with high reasoning effort** for:

- Reviewing completed implementations
- Finding hidden bugs
- Security review
- Performance review
- Checking architectural correctness
- Detecting edge cases
- Reviewing database changes
- Reviewing authentication/authorization
- Checking regressions

Focus on finding real problems rather than changing code merely because of stylistic preferences.

---

# Routing Priority

When uncertain between two levels, choose the higher level if the task affects:

- Security
- Data integrity
- Authentication
- Authorization
- Architecture
- Production-critical functionality
- Multiple interconnected systems

Otherwise choose the lower level.

# Default

For unspecified tasks:

**GPT-5.6 Terra / Medium**

Do not use GPT-5.6 Sol / Max for simple or routine tasks.

Use maximum reasoning primarily when the problem genuinely requires deep architectural or technical reasoning.
