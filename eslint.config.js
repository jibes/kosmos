import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: ['dist/', 'coverage/', 'playwright-report/', 'test-results/', 'android/', 'dev-dist/'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  // config key differs by plugin major; v7 ships flat configs under `flat`
  reactHooks.configs.flat['recommended-latest'],
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);
