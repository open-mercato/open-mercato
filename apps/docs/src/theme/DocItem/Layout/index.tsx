import React from 'react';
import Layout from '@theme-original/DocItem/Layout';
import type LayoutType from '@theme/DocItem/Layout';
import type { WrapperProps } from '@docusaurus/types';
import CopyPageButton from '@site/src/components/CopyPageButton';
import styles from './styles.module.css';

type Props = WrapperProps<typeof LayoutType>;

export default function LayoutWrapper(props: Props): React.ReactElement {
  return (
    <div className={styles.docItemLayoutWrapper}>
      <div className={styles.copyButtonContainer}>
        <CopyPageButton />
      </div>
      <Layout {...props} />
    </div>
  );
}
