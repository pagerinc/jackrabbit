FROM node:14.17-alpine@sha256:5bae4f38090acf1a6817b5656b6ab4d26e86385b7e9a6005a0da436af6da6fef

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
