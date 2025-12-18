import { useEffect } from 'react';

export function dispatch<T>(element: HTMLElement, eventName: string, payload: T) {
  console.log('Dispatching event:', element, eventName, payload);
  const event = new CustomEvent(eventName, {
    detail: payload,
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(event);
}

export function useMediator<T>(eventName: string, handler: (payload: any) => void, elementRef: React.RefObject<HTMLElement> | null) {
  useEffect(() => {
    const element = elementRef?.current;
    if (!element) return;

    const listener = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      handler((event as CustomEvent).detail);
    };

    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [eventName, handler, elementRef?.current]);
}

export function useListener<T>(eventName: string, handler: (payload: any) => void, elementRef: React.RefObject<HTMLElement> | null) {
  useEffect(() => {
    const element = elementRef?.current;
    if (!element) return;

    const listener = (event: Event) => {
      handler((event as CustomEvent).detail);
    };

    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [eventName, handler, elementRef?.current]);
}