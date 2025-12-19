import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import TableSkeleton from './TableSkeleton';

const meta: Meta<typeof TableSkeleton> = {
  title: 'Backend/Tables/Table Skeleton',
  component: TableSkeleton,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    rows: {
      control: { type: 'number', min: 1, max: 50 },
      description: 'Number of skeleton rows to display',
      defaultValue: 10,
    },
    columns: {
      control: { type: 'number', min: 1, max: 20 },
      description: 'Number of skeleton columns to display',
      defaultValue: 6,
    },
    rowHeaders: {
      control: 'boolean',
      description: 'Whether to show row headers',
      defaultValue: true,
    },
    colHeaders: {
      control: 'boolean',
      description: 'Whether to show column headers',
      defaultValue: true,
    },
    height: {
      control: 'text',
      description: 'Height of the skeleton container',
      defaultValue: '600px',
    },
    width: {
      control: 'text',
      description: 'Width of the skeleton container',
      defaultValue: 'auto',
    },
    tableName: {
      control: 'text',
      description: 'Table name to display in header',
      defaultValue: 'Loading...',
    },
  },
};

export default meta;
type Story = StoryObj<typeof TableSkeleton>;

// Default skeleton
export const Default: Story = {
  args: {
    rows: 10,
    columns: 6,
    rowHeaders: true,
    colHeaders: true,
    height: '600px',
    width: 'auto',
    tableName: 'Loading...',
  },
};

// Small skeleton (few rows and columns)
export const Small: Story = {
  args: {
    rows: 5,
    columns: 4,
    rowHeaders: true,
    colHeaders: true,
    height: '400px',
    width: 'auto',
    tableName: 'Loading data...',
  },
};

// Large skeleton (many rows and columns)
export const Large: Story = {
  args: {
    rows: 20,
    columns: 10,
    rowHeaders: true,
    colHeaders: true,
    height: '800px',
    width: 'auto',
    tableName: 'Loading large dataset...',
  },
};

// Custom column widths
export const CustomColumnWidths: Story = {
  args: {
    rows: 8,
    columns: 5,
    rowHeaders: true,
    colHeaders: true,
    height: '500px',
    width: 'auto',
    tableName: 'Loading custom layout...',
    columnWidths: [60, 150, 220, 130, 100],
  },
};


// Skeleton with reload button
export const WithReloadButton: Story = {
  render: () => {
    const [loading, setLoading] = React.useState(false);

    const handleReload = () => {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
      }, 2000);
    };

    return (
      <div>
        <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={handleReload}
            disabled={loading}
            style={{
              padding: '8px 16px',
              background: loading ? '#d0d0d0' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '14px'
            }}
          >
            {loading ? 'Loading...' : 'Simulate Loading'}
          </button>
          <span style={{ fontSize: '14px', color: '#666' }}>
            Click to see the skeleton loader in action
          </span>
        </div>
        {loading ? (
          <TableSkeleton
            rows={3}
            columns={11}
            rowHeaders={true}
            colHeaders={true}
            height="600px"
            tableName="Reloading data..."
          />
        ) : (
          <div style={{ 
            padding: '40px', 
            textAlign: 'center', 
            border: '2px solid #e0e0e0',
            borderRadius: '8px',
            background: 'white'
          }}>
            <p style={{ margin: 0, fontSize: '16px', color: '#333' }}>✨ Table ready - Click button to reload</p>
          </div>
        )}
      </div>
    );
  },
};