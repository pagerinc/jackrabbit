FROM node:14.19-alpine@sha256:179b0166fc11382a46637022bd7ee330021ff97fe90ae014174761cf5f88a269

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
