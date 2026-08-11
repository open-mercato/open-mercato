import React, { useEffect, useRef } from 'react';
import Layout from '@theme-original/DocItem/Layout';
import type LayoutType from '@theme/DocItem/Layout';
import CopyPageButton from '@site/src/components/CopyPageButton';
import { createPortal } from 'react-dom';

type Props = React.ComponentProps<typeof LayoutType>;

function CopyButtonPortal(): React.ReactElement | null {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);

  useEffect(() => {
    // Find the article element inside the doc layout and inject our button container
    const article = document.querySelector('article');
    if (!article) return;

    const el = document.createElement('div');
    el.className = 'copy-page-button-container';
    // Insert as the first child of the article
    article.insertBefore(el, article.firstChild);
    setContainer(el);

    return () => {
      el.remove();
    };
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
