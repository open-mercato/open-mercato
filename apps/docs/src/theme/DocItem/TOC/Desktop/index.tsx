import React from 'react';
import TOCDesktop from '@theme-original/DocItem/TOC/Desktop';
import type TOCDesktopType from '@theme/DocItem/TOC/Desktop';
import CopyPageButton from '@site/src/components/CopyPageButton';

type Props = React.ComponentProps<typeof TOCDesktopType>;

export default function TOCDesktopWrapper(props: Props): React.ReactElement {
  return (
    <>
      <div className="copy-page-toc-button">
        <CopyPageButton wide />
      </div>
      <TOCDesktop {...props} />
    </>
  );
}
