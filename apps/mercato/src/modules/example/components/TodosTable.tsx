import React, { useCallback } from 'react';
import { Table } from '@open-mercato/ui';
import { useTranslation } from 'react-i18next';

interface Todo {
  id: string;
  title: string;
  isDone: boolean;
}

export const TodosTable: React.FC<{ todos: Todo[]; onToggle: (id: string) => void }> = ({ todos, onToggle }) => {
  const { t } = useTranslation();

  // Hook moved outside of any conditional logic to follow Rules of Hooks
  const handleToggle = useCallback((id: string) => {
    onToggle(id);
  }, [onToggle]);

  if (!todos || todos.length === 0) {
    return <div>{t('example.todos.empty')}</div>;
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('example.todos.title')}</th>
          <th>{t('example.todos.status')}</th>
        </tr>
      </thead>
      <tbody>
        {todos.map((todo) => (
          <tr key={todo.id} onClick={() => handleToggle(todo.id)}>
            <td>{todo.title}</td>
            <td>{todo.isDone ? t('example.todos.done') : t('example.todos.pending')}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};
