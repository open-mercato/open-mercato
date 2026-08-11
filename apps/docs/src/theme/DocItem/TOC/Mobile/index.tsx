import React from 'react';
import TOCMobile from '@theme-original/DocItem/TOC/Mobile';
import type TOCMobileType from '@theme/DocItem/TOC/Mobile';
import CopyPageButton from '@site/src/components/CopyPageButton';

type Props = React.ComponentProps<typeof TOCMobileType>;

export default function TOCMobileWrapper(props: Props): React.ReactElement {
  return (
    <>
      <div className="copy-page-toc-button copy-page-toc-button--mobile">
        <CopyPageButton wide />
      </div>
      <TOCMobile {...props} />
    </>
  );
}
