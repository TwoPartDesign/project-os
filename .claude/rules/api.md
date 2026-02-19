---
globs: ["**/api/**", "**/routes/**", "**/handlers/**"]
description: "Rules applied when working with API code"
---

- Every endpoint must validate input before processing
- Return structured errors: { error: string, code: string, details?: any }
- Log errors with context (request ID, user, action) — never log sensitive data
- Set appropriate HTTP status codes — don't return 200 for errors
- Include rate limiting considerations in design
- Document the endpoint in the design spec before implementing
