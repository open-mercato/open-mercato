import React from 'react';
import Layout from '@theme-original/DocItem/Layout';
import type LayoutType from '@theme/DocItem/Layout';
import CopyPageButton from '@site/src/components/CopyPageButton';

type Props = React.ComponentProps<typeof LayoutType>;

export default function LayoutWrapper(props: Props): React.ReactElement {
  return (
    <>
      <div className="copy-page-button-container">
        <CopyPageButton />
      </div>
      <Layout {...props} />
    </>
  );
}
