import React, { useCallback } from 'react';
import { Table } from '@open-mercato/ui';
import { useTranslation } from 'react-i18next';

interface Todo {
  id: string;
  title: string;
  isDone: boolean;
  severity?: 'low' | 'medium' | 'high';
}

export const TodosTable: React.FC<{ 
  todos: Todo[]; 
  onToggle: (id: string) => void;
  severityPreset?: string; 
}> = ({ todos, onToggle, severityPreset }) => {
  const { t } = useTranslation();

  const handleToggle = useCallback((id: string) => {
    onToggle(id);
  }, [onToggle]);

  // اضافه کردن وابستگی severityPreset برای رفع خطای Lint
  const getSeverityLabel = useCallback((severity?: string) => {
    if (severityPreset) return severityPreset;
    return severity || t('example.todos.no_severity');
  }, [t, severityPreset]); 

  if (!todos || todos.length === 0) {
    return <div>{t('example.todos.empty')}</div>;
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('example.todos.title')}</th>
          <th>{t('example.todos.severity')}</th>
          <th>{t('example.todos.status')}</th>
        </tr>
      </thead>
      <tbody>
        {todos.map((todo) => (
          <tr key={todo.id} onClick={() => handleToggle(todo.id)} style={{ cursor: 'pointer' }}>
            <td>{todo.title}</td>
            <td>{getSeverityLabel(todo.severity)}</td>
            <td>{todo.isDone ? t('example.todos.done') : t('example.todos.pending')}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

