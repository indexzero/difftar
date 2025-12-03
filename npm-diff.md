# npm diff & libnpmdiff Technical Summary

## npm diff Command

CLI command (npm 7.5.0+) generating unified diff patches between npm packages. Produces git-style output.

**Core usage:**

```bash
npm diff                                  # local vs latest published
npm diff --diff=pkg@1.0 --diff=pkg@2.0    # compare two versions
```

**Key options:** `--diff=<spec>` (twice for comparison), `--diff-name-only`, `--diff-unified=N`, `--diff-ignore-all-space`

---

## libnpmdiff (Core Library)

```javascript
const patch = await libnpmdiff(['pkg@1.0.0', 'pkg@2.0.0'], opts);
```

**Processing flow:**

1. Parse specs via `npm-package-arg`
2. Fetch manifests/tarballs in parallel via `pacote`
3. Extract to temp dirs using `tar`
4. Compare using `diff.createTwoFilesPatch()` (Myers algorithm)
5. Format as unified diff

---

## Key Dependencies

| Package | Role |
|---------|------|
| **pacote** | Fetches manifests + tarballs from registry, handles caching |
| **diff** (jsdiff) | Myers' O(ND) text comparison algorithm |
| **npm-package-arg** | Parses package specifiers (`foo@1.2`, `@org/pkg`, git URLs) |
| **tar** | Extracts .tgz archives |
| **@npmcli/arborist** | Dependency tree management |
| **binary-extensions** | Detects binary files to skip |

---

## Output Format

```diff
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,3 +1,3 @@
-  "version": "1.0.0"
+  "version": "2.0.0"
```

**Implementation notes:** Parallel fetching, file mode tracking, cacache caching, workspace-aware.
