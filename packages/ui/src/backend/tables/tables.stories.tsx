import type { Meta, StoryObj } from '@storybook/react';
import Table from './index';

const meta: Meta<typeof Table> = {
    title: 'Backend/Tables',
    component: Table,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
    argTypes: {
        colHeaders: { control: 'boolean' },
        rowHeaders: { control: 'boolean' },
        height: { control: 'text' },
        width: { control: 'text' },
    },
};

export default meta;
type Story = StoryObj<typeof Table>;

// Generate large dataset - 1000 rows x 45 columns
const generateLargeData = () => {
    const data = [];
    const firstNames = ['John', 'Jane', 'Bob', 'Alice', 'Mike', 'Sarah', 'Tom', 'Emma', 'David', 'Lisa'];
    const lastNames = ['Smith', 'Johnson', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas'];
    const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose'];
    const departments = ['Sales', 'Engineering', 'Marketing', 'HR', 'Finance', 'Operations', 'IT', 'Support', 'Legal', 'Design'];
    const products = ['Product A', 'Product B', 'Product C', 'Product D', 'Product E', 'Product F', 'Product G', 'Product H', 'Product I', 'Product J'];
    
    for (let i = 0; i < 1000; i++) {
        const row = {
            id: i + 1,
            firstName: firstNames[Math.floor(Math.random() * firstNames.length)],
            lastName: lastNames[Math.floor(Math.random() * lastNames.length)],
            email: `user${i + 1}@example.com`,
            age: Math.floor(Math.random() * 50) + 20,
            salary: Math.floor(Math.random() * 100000) + 30000,
            department: departments[Math.floor(Math.random() * departments.length)],
            city: cities[Math.floor(Math.random() * cities.length)],
            startDate: new Date(2015 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString().split('T')[0],
            active: Math.random() > 0.3,
            score1: Math.floor(Math.random() * 100),
            score2: Math.floor(Math.random() * 100),
            score3: Math.floor(Math.random() * 100),
            score4: Math.floor(Math.random() * 100),
            score5: Math.floor(Math.random() * 100),
            metric1: (Math.random() * 1000).toFixed(2),
            metric2: (Math.random() * 1000).toFixed(2),
            metric3: (Math.random() * 1000).toFixed(2),
            metric4: (Math.random() * 1000).toFixed(2),
            metric5: (Math.random() * 1000).toFixed(2),
            product1: products[Math.floor(Math.random() * products.length)],
            product2: products[Math.floor(Math.random() * products.length)],
            product3: products[Math.floor(Math.random() * products.length)],
            product4: products[Math.floor(Math.random() * products.length)],
            product5: products[Math.floor(Math.random() * products.length)],
            value1: Math.floor(Math.random() * 10000),
            value2: Math.floor(Math.random() * 10000),
            value3: Math.floor(Math.random() * 10000),
            value4: Math.floor(Math.random() * 10000),
            value5: Math.floor(Math.random() * 10000),
            rating1: (Math.random() * 5).toFixed(1),
            rating2: (Math.random() * 5).toFixed(1),
            rating3: (Math.random() * 5).toFixed(1),
            rating4: (Math.random() * 5).toFixed(1),
            rating5: (Math.random() * 5).toFixed(1),
            status1: Math.random() > 0.5 ? 'Active' : 'Inactive',
            status2: Math.random() > 0.5 ? 'Approved' : 'Pending',
            status3: Math.random() > 0.5 ? 'Complete' : 'In Progress',
            status4: Math.random() > 0.5 ? 'Success' : 'Failed',
            status5: Math.random() > 0.5 ? 'Available' : 'Unavailable',
            code1: `CODE-${Math.floor(Math.random() * 10000)}`,
            code2: `REF-${Math.floor(Math.random() * 10000)}`,
            code3: `ID-${Math.floor(Math.random() * 10000)}`,
            code4: `TAG-${Math.floor(Math.random() * 10000)}`,
            code5: `KEY-${Math.floor(Math.random() * 10000)}`,
        };
        data.push(row);
    }
    
    return data;
};

const largeDataColumns = [
    { data: 'id', width: 60, title: 'ID', readOnly: true },
    { data: 'firstName', width: 120, title: 'First Name' },
    { data: 'lastName', width: 120, title: 'Last Name' },
    { data: 'email', width: 200, title: 'Email' },
    { data: 'age', width: 60, title: 'Age' },
    { data: 'salary', width: 100, title: 'Salary' },
    { data: 'department', width: 120, title: 'Department' },
    { data: 'city', width: 120, title: 'City' },
    { data: 'startDate', width: 100, title: 'Start Date' },
    { data: 'active', width: 80, title: 'Active' },
    { data: 'score1', width: 80, title: 'Score 1' },
    { data: 'score2', width: 80, title: 'Score 2' },
    { data: 'score3', width: 80, title: 'Score 3' },
    { data: 'score4', width: 80, title: 'Score 4' },
    { data: 'score5', width: 80, title: 'Score 5' },
    { data: 'metric1', width: 100, title: 'Metric 1' },
    { data: 'metric2', width: 100, title: 'Metric 2' },
    { data: 'metric3', width: 100, title: 'Metric 3' },
    { data: 'metric4', width: 100, title: 'Metric 4' },
    { data: 'metric5', width: 100, title: 'Metric 5' },
    { data: 'product1', width: 100, title: 'Product 1' },
    { data: 'product2', width: 100, title: 'Product 2' },
    { data: 'product3', width: 100, title: 'Product 3' },
    { data: 'product4', width: 100, title: 'Product 4' },
    { data: 'product5', width: 100, title: 'Product 5' },
    { data: 'value1', width: 100, title: 'Value 1' },
    { data: 'value2', width: 100, title: 'Value 2' },
    { data: 'value3', width: 100, title: 'Value 3' },
    { data: 'value4', width: 100, title: 'Value 4' },
    { data: 'value5', width: 100, title: 'Value 5' },
    { data: 'rating1', width: 80, title: 'Rating 1' },
    { data: 'rating2', width: 80, title: 'Rating 2' },
    { data: 'rating3', width: 80, title: 'Rating 3' },
    { data: 'rating4', width: 80, title: 'Rating 4' },
    { data: 'rating5', width: 80, title: 'Rating 5' },
    { data: 'status1', width: 100, title: 'Status 1' },
    { data: 'status2', width: 100, title: 'Status 2' },
    { data: 'status3', width: 120, title: 'Status 3' },
    { data: 'status4', width: 100, title: 'Status 4' },
    { data: 'status5', width: 120, title: 'Status 5' },
    { data: 'code1', width: 120, title: 'Code 1' },
    { data: 'code2', width: 120, title: 'Code 2' },
    { data: 'code3', width: 120, title: 'Code 3' },
    { data: 'code4', width: 120, title: 'Code 4' },
    { data: 'code5', width: 120, title: 'Code 5' },
];

// Small dataset for basic testing
const sampleData = [
    { id: 1, name: 'John Doe', email: 'john@example.com', age: 28, active: true },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com', age: 34, active: true },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com', age: 45, active: false },
    { id: 4, name: 'Alice Brown', email: 'alice@example.com', age: 29, active: true },
];

const sampleColumns = [
    { data: 'id', width: 60, readOnly: true, title: 'ID' },
    { data: 'name', width: 150, title: 'Name' },
    { data: 'email', width: 200, title: 'Email' },
    { data: 'age', width: 80, title: 'Age' },
    { data: 'active', width: 100, title: 'Active' },
];

export const Basic: Story = {
    args: {
        data: sampleData,
        columns: sampleColumns,
        colHeaders: true,
        rowHeaders: true,
        height: 'auto',
        width: '100%',
    },
    decorators: [
        (Story) => (
            <div className="max-w-6xl mx-auto p-4">
                <Story />
            </div>
        ),
    ],
};

export const LargeDataset: Story = {
    args: {
        data: generateLargeData(),
        columns: largeDataColumns,
        colHeaders: true,
        rowHeaders: true,
        height: '600px',
        width: '100%',
    },
    decorators: [
        (Story) => (
            <div className="max-w-full mx-auto p-4">
                <h2 className="text-xl font-bold mb-4">Performance Test: 1000 rows × 45 columns</h2>
                <Story />
            </div>
        ),
    ],
};

export const WithoutHeaders: Story = {
    args: {
        data: sampleData,
        columns: sampleColumns,
        colHeaders: false,
        rowHeaders: false,
        height: 'auto',
        width: '100%',
    },
};

export const CustomHeight: Story = {
    args: {
        data: generateLargeData(),
        columns: largeDataColumns,
        colHeaders: true,
        rowHeaders: true,
        height: '400px',
        width: '100%',
    },
    decorators: [
        (Story) => (
            <div className="max-w-full mx-auto p-4">
                <Story />
            </div>
        ),
    ],
};