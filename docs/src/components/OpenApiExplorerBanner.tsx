import React from 'react';
import Admonition from '@theme/Admonition';
import Link from '@docusaurus/Link';

export default function OpenApiExplorerBanner(): JSX.Element {
  return (
    <Admonition type="tip" title="Explore the API">
      Launch the{' '}
      <Link to="/docs/api" aria-label="Open the OpenAPI Explorer">
        OpenAPI Explorer
      </Link>{' '}
      to browse the live REST specs, inspect request and response schemas, and
      execute calls against your environment with an API key.
    </Admonition>
  );
}
