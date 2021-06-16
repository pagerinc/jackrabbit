FROM node:14.17-alpine@sha256:cc1a31b2f4a3b8e9cdc6f8dc0c39a3b946d7aa5d10a53439d960d4352b2acfc0

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
