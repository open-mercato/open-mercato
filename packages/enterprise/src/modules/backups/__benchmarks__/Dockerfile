FROM node:24 AS tools
COPY evict.c /tmp/evict.c
RUN cc /tmp/evict.c -O2 -o /tmp/evict
FROM postgres:16
COPY --from=tools /usr/local/bin/node /usr/local/bin/node
COPY --from=tools /tmp/evict /opt/evict
