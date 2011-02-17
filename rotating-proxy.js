var http = require('http');

// engage with:
// sudo iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080 -m owner '!' --uid-owner nobody
// then run this script as nobody

var replaces = {
    '<body': function(){
      var effect = 'rotate('+(2*Math.random()-1)+'deg) scale('+(1 + 0.2*(Math.random()-0.5))+')';
      return '<body style="-moz-transform: '+effect+'; -webkit-transform: '+effect+';"';
    }
};

var clientCount = 0, serverCount = 0;

http.createServer(function(proxiedReq, proxiedRes) {
  // when clients send us requests
  delete proxiedReq.headers['accept-encoding']; // turn off gzip
  var newReq = http
    .createClient(80, proxiedReq.headers.host)
    .request(proxiedReq.method, proxiedReq.url, proxiedReq.headers);

  newReq.addListener('error', function(error) {
    console.log(error);
  });
  proxiedReq.connection.setMaxListeners(15);
  proxiedReq.connection.addListener('error', function(error) {
    console.log(error);
  });

  newReq.addListener('response', function(newRes) {
    // when the server gives us our response
    var html=(newRes.headers['content-type'] && 
              newRes.headers['content-type']
                .toLowerCase()
                .indexOf("text/html") != -1),
        buffer = "";
    newRes.addListener('error', function(error) {
      console.log(error);
    });
    newRes.addListener('data', function(chunk) {
      if (html) {
        // potentially store in a string and rewrite
        buffer += chunk.toString('utf-8');
      } else {
        // binary data, just pass it through
        proxiedRes.write(chunk, 'binary');
      }
    });
    newRes.addListener('end', function() {
      if (html) {
        for (var needle in replaces) {
          if (replaces.hasOwnProperty(needle)) {
            var result = typeof replaces[needle]=='function'?
                           replaces[needle]()
                         : replaces[needle];
            buffer = buffer.replace(needle, result);
          }
        }
        proxiedRes.end(buffer);
      } else {
        proxiedRes.end();
      }
    });
    // pass headers on to the client
    delete newRes.headers['content-length'];
    proxiedRes.writeHead(newRes.statusCode, newRes.headers);
  });

  newReq.addListener('data', function(chunk) {
    proxiedRes.write(chunk, 'binary');
  });

  newReq.addListener('end', function() {
    proxiedRes.end();
  });

  newReq.end();
}).listen(8080);
