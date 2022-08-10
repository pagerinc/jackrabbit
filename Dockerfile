FROM node:14.20-alpine@sha256:53e7663707462f04d85e6c73e19517a55213bd9fcc16192526fd55e01031925f

RUN apk add --no-cache tini

ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /home/node/app

COPY package.json package-lock.json /home/node/app/

RUN chown -R node /home/node && \
	apk add --no-cache --virtual .build-deps && \
	npm install --quiet && \
	npm cache clean --force && \
	apk del .build-deps

COPY . /home/node/app

USER node

CMD ["npm", "test"]
