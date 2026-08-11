import React, { useEffect } from 'react';
import Layout from '@theme-original/DocItem/Layout';
import type LayoutType from '@theme/DocItem/Layout';
import CopyPageButton from '@site/src/components/CopyPageButton';
import { createPortal } from 'react-dom';

type Props = React.ComponentProps<typeof LayoutType>;

function CopyButtonPortal(): React.ReactElement | null {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);

  useEffect(() => {
    // Find the breadcrumbs nav and insert button container next to it
    const breadcrumbs = document.querySelector('.theme-doc-breadcrumbs');
    if (breadcrumbs) {
      // Wrap breadcrumbs + button in a flex row
      const wrapper = document.createElement('div');
      wrapper.className = 'copy-page-breadcrumb-row';
      breadcrumbs.parentNode?.insertBefore(wrapper, breadcrumbs);
      wrapper.appendChild(breadcrumbs);

      const el = document.createElement('div');
      el.className = 'copy-page-button-container';
      wrapper.appendChild(el);
      setContainer(el);

      return () => {
        // Restore breadcrumbs to original position
        wrapper.parentNode?.insertBefore(breadcrumbs, wrapper);
        wrapper.remove();
      };
    }

    // Fallback: no breadcrumbs — put before the markdown content
    const markdown = document.querySelector('.theme-doc-markdown');
    if (markdown) {
      const el = document.createElement('div');
      el.className = 'copy-page-button-container';
      markdown.parentNode?.insertBefore(el, markdown);
      setContainer(el);

      return () => {
        el.remove();
      };
    }

    return undefined;
  }, []);

  if (!container) return null;
  return createPortal(<CopyPageButton />, container);
}

export default function LayoutWrapper(props: Props): React.ReactElement {
  return (
    <>
      <Layout {...props} />
      <CopyButtonPortal />
    </>
  );
}
