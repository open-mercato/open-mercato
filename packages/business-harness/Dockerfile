FROM node:24-alpine AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/business-harness/package.json packages/business-harness/package.json
RUN yarn workspaces focus @open-mercato/business-harness

COPY packages/business-harness packages/business-harness
RUN yarn workspace @open-mercato/business-harness build

FROM node:24-alpine AS runtime

WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages/business-harness/node_modules ./packages/business-harness/node_modules
COPY --from=build /workspace/packages/business-harness/package.json ./packages/business-harness/package.json
COPY --from=build /workspace/packages/business-harness/dist ./packages/business-harness/dist
COPY --from=build /workspace/packages/business-harness/harness.config.container.json ./packages/business-harness/harness.config.container.json
COPY --from=build /workspace/packages/business-harness/harness.config.compose.json ./packages/business-harness/harness.config.compose.json

USER node
EXPOSE 4300
ENTRYPOINT ["node", "packages/business-harness/dist/cli.js"]
CMD ["serve"]
