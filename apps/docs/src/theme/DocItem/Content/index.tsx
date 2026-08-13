import React from 'react';
import Content from '@theme-original/DocItem/Content';
import type ContentType from '@theme/DocItem/Content';
import CopyPageButton from '@site/src/components/CopyPageButton';

type Props = React.ComponentProps<typeof ContentType>;

export default function ContentWrapper(props: Props): React.ReactElement {
  return (
    <>
      <div className="copy-page-content-button">
        <CopyPageButton />
      </div>
      <Content {...props} />
    </>
  );
}
