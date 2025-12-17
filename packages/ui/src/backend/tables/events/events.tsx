import { useEffect } from 'react';

export function dispatch(element, eventName, payload) {
  console.log('Dispatching event:', element, eventName, payload);
  const event = new CustomEvent(eventName, {
    detail: payload,
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(event);
}

export function useMediator(eventName, handler, elementRef) {
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    
    const listener = (event) => {
      event.stopPropagation();
      event.preventDefault();
      handler(event.detail);
    };
    
    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [eventName, handler, elementRef]);
}

export function useListener(eventName, handler, elementRef) {
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    
    const listener = (event) => {
      handler(event.detail);
    };
    
    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [eventName, handler, elementRef]);
}