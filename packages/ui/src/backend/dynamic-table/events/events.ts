// events/events.ts

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EventHandlers, TableEventPayloads } from '../types/index';

export function dispatch<T>(element: HTMLElement, eventName: string, payload: T) {
  const event = new CustomEvent(eventName, {
    detail: payload,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
}

export function useMediator<T>(
  eventName: string,
  handler: (payload: T) => void,
  elementRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const element = elementRef?.current;
    if (!element) return;

    const listener = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      handler((event as CustomEvent<T>).detail);
    };

    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [eventName, handler, elementRef]);
}

export function useListener<T>(
  eventName: string,
  handler: (payload: T) => void,
  elementRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const element = elementRef?.current;
    if (!element) return;

    const listener = (event: Event) => {
      handler((event as CustomEvent<T>).detail);
    };

    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [eventName, handler, elementRef]);
}

export interface UseEventHandlersOptions {
  stopPropagation?: boolean;
}

export function useEventHandlers(
  handlers: EventHandlers,
  elementRef: React.RefObject<HTMLElement | null>,
  options: UseEventHandlersOptions = { stopPropagation: true }
) {
  // Use ref to avoid re-registering listeners on every handler change
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Track element in state so effect re-runs when ref.current becomes available
  const [element, setElement] = useState<HTMLElement | null>(null);

  // Check for ref changes on every render (useLayoutEffect runs synchronously after DOM mutations)
  useLayoutEffect(() => {
    if (elementRef?.current !== element) {
      setElement(elementRef?.current ?? null);
    }
  });

  useEffect(() => {
    if (!element) return;

    const eventNames = Object.keys(handlersRef.current) as Array<keyof TableEventPayloads>;
    const listeners: Array<[string, EventListener]> = [];

    for (const eventName of eventNames) {
      const listener = (event: Event) => {
        const handler = handlersRef.current[eventName];
        if (!handler) return;

        if (options.stopPropagation) {
          event.stopPropagation();
          event.preventDefault();
        }
        handler((event as CustomEvent).detail);
      };

      element.addEventListener(eventName, listener);
      listeners.push([eventName, listener]);
    }

    return () => {
      for (const [eventName, listener] of listeners) {
        element.removeEventListener(eventName, listener);
      }
    };
  }, [element, options.stopPropagation]);
}
