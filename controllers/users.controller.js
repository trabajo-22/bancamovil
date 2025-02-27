const { response, request } = require("express");
const Usuario = require("../models/user");
const bcrypt = require("bcrypt");
const _ = require("underscore");
const soap = require("soap");
const { generarJWT, generarJWTRecuperacion } = require("../helpers/generarjwt");
const Dato = require("../models/dato");
const setting = require("../models/setting");
const Solicitudotp = require("../models/solicitudotp");
const { enviarEmailContrasenaTemporal } = require("../emails/Recuperarcontrasena");
const { enviarEmailRecuperarUsuario } = require("../emails/Recuperarusuario");
const { guardarSolicitudRecuperarContrasenia, verificarMaximoSolicitudRecuperarContraPorDia } = require("../controllers/solicitudrecuperarcontrasena.controller");
const { guardarSolicitudRecuperarUsuario, verificarMaximoSolicitudRecuperarUserPorDia } = require("../controllers/solicitudrecuperarusuario.controller");
const { guardarSolicitudDesbloquear } = require("../controllers/solicituddesbloquearcuenta.controller");
const { verificarSiTieneCuentasActivas, verificarSiEsSocio, obtenerDatosCliente } = require("../models/user.sql");
const url = process.env.SOAP;


const verificaCheckTemporal = async (req = request, res = response) => {
  res.json({ ok: true });
};

const enviarUsuarioCliente = async (req, res) => {
  const { identificacion } = req.body;
  const usuario = await Usuario.findOne({ identificacion: identificacion });
  await enviarEmailRecuperarUsuario(usuario.email, usuario.nombre, usuario.nick);
  res.status(200).json({ "response": "Usuario enviado correctamente" });
}

const updateUsuario = async (req, res) => {
  const { identificacion, nick } = req.body;
  if (!identificacion) {
    return res.status(400).json({ error: 'El campo identificación es requerido.' });
  }
  try {
    const usuario = await Usuario.findOne({ identificacion });
    if (!usuario) {
      return res.status(400).json({ error: 'Usuario no encontrado.' });
    }
    usuario.nick = nick;
    await usuario.save();
    return res.status(200).json({
      message: 'Usuario actualizado con exito. Por favor, inicie sesión con su nuevo usuario.'
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error al actualizar el usuario.' });
  }
};


const nuevasContrasena = async (req, res) => {
  const { contrasena1, contrasena2, identificacion } = req.body;
  if (contrasena1 == contrasena2) {
    var usuario = await Usuario.findOne({ identificacion });
    let contrasenaEncry = bcrypt.hashSync(contrasena1, 10, function (err, hash) {
      if (err) {
        console.log(err);
      }
    });

    // actualizar en tabla usuarios(password, check, y role)
    usuario.password = contrasenaEncry;
    usuario.check = 'true';
    usuario.role = 'Role_User';
    await usuario.save();

    let esSocio = await verificarSiEsSocio(identificacion);
    const token = await generarJWT(usuario._id, false, identificacion);
    res.json({
      token: token,
      user: {
        nombre: usuario.nombre,
        nick: usuario.nick,
        img: usuario.img,
        oficina: usuario.oficina,
        role: usuario.role,
        cedula: identificacion,
        essocio: esSocio,
        check: usuario.check
      }
    });
    return;
  } else {
    return res.status(400).json({ error: "Las contraseñas no coinciden!" });
  }
}

const enviarUsuarioRecuperarPorEmail = async (req, res) => {
  const identificacion = req.user;
  const { codigootp } = req.body;
  console.log('codigo', s)

  const solicitudotp = await Solicitudotp.findOne({ identificacion: identificacion, esvalidado: false }).sort({ $natural: -1 }).limit(1);
  if (!bcrypt.compareSync(codigootp, solicitudotp.tokens)) {
    res.status(400).json({ "error": "Código OTP Inválido" });
  } else {
    solicitudotp.esvalidado = true;
    await solicitudotp.save();
    let cliente = await obtenerDatosCliente(identificacion);
    const user = await Usuario.findOne({ identificacion: identificacion });
    await enviarEmailRecuperarUsuario(cliente.email, cliente.nombres, user.nick);
    res.status(200).json({ "response": "Usuario enviado correctamente" });
  }
}



const verificaCodigo = async (req, res) => {
  const identificacion = req.user;
  const { codigootp } = req.body;
  const solicitudotp = await Solicitudotp.findOne({ identificacion: identificacion, esvalidado: false }).sort({ $natural: -1 }).limit(1);
  if (!bcrypt.compareSync(codigootp, solicitudotp.tokens)) {
    res.status(400).json({ "error": "El código ingresado es Inválido" });
  } else {
    solicitudotp.esvalidado = true;
    await solicitudotp.save();
    res.status(200).json({ "response": "Usuario enviado correctamente" });
  }
}




//  RECUPERAR CUENTA
const enviarCodigoOTPDesbloquearCuenta = async (req, res) => {
  const { identificacion } = req.body;
  var usuario = await Usuario.findOne({ identificacion });
  if (usuario) {
    if (usuario.estado == false) {
      const tokenENVIO = await generarJWT(usuario._id, false, identificacion);
      var codigoOtp = generarCodigoAleatorio() + '';
      console.log(codigoOtp)
      // encripta el codigo otp
      var token = bcrypt.hashSync(codigoOtp, 10,
        function (err, hash) {
          if (err) {
            console.log(err)
            res.status(500).json({ "error": err });
          }
        }
      );
      await enviarSmsCodigoOtp(codigoOtp, identificacion);
      let solicitudotp = new Solicitudotp({
        identificacion: identificacion,
        tokens: token,
        esvalidado: false,
        transaccion: 'OTP-DESBLOQUEO-USER'
      });

      await solicitudotp.save();
      await guardarSolicitudDesbloquear(identificacion);
      //  await desbloquearUsuario(identificacion)
      res.status(200).json({ "response": usuario, "token": tokenENVIO });
    } else {
      res.status(400).json({ "error": "Su cuenta no está bloqueada. Por favor, inicie sesión con sus credenciales." });
    }

  } else {
    res.status(400).json({ "error": "No existe una cuenta creada en MiFuturo, ¡Crea una cuenta!", });
    return
  }
}

const desbloquearUsuario = async (identificacion) => {
  var usuario = await Usuario.findOne({ identificacion });
  usuario.estado = true;
  usuario.save();
}

// 1205283417
const enviarCodigoOTPRecuperarUsuario = async (req, res) => {
  const { identificacion } = req.body;
  var usuario = await Usuario.findOne({ identificacion });
  if (usuario) {
    if (usuario.estado == true) {
      let superoMaximoSolicitud = await verificarMaximoSolicitudRecuperarUserPorDia(identificacion);
      if (!superoMaximoSolicitud) {
        const tokenENVIO = await generarJWT(usuario._id, false, identificacion);

        var codigoOtp = generarCodigoAleatorio() + '';
        console.log('mi codigp ', codigoOtp)
        // encripta el codigo otp
        var token = bcrypt.hashSync(codigoOtp, 10,
          function (err, hash) {
            if (err) {
              console.log(err)
              res.status(500).json({ "error": err });
            }
          }
        );
        await enviarSmsCodigoOtp(codigoOtp, identificacion);
        let solicitudotp = new Solicitudotp({
          identificacion: identificacion,
          tokens: token,
          esvalidado: false,
          transaccion: 'OTP-RECUPERACION-USER'
        });
        await solicitudotp.save();
        await guardarSolicitudRecuperarUsuario(identificacion);
        res.status(200).json({ "response": usuario.nombre, "token": tokenENVIO, "usuario": usuario._id, "cedula": usuario.identificacion });
      } else {
        // await bloquearUsuario(identificacion);
        res.status(400).json({ "error": "Superaste el número máximo de solicitudes de recuperación de usuario, inténtalo nuevamente después de 24 horas.", });
      }
    } else {
      res.status(400).json({ "error": "Su cuenta esta bloqueada, desbloque su cuenta para continuar" });
    }
  } else {
    res.status(400).json({ "error": "No existe una cuenta creada en MiFuturo, ¡Crea una cuenta!", });
    return
  }
}



// CAMBIAR ESTADO USUARIO TRUE
const cambiarEstado = async (req, res) => {
  try {
    const { identificacion, user } = req.body;
    console.log('cedula', identificacion, 'user', user)
    var usuario = await Usuario.findOne({ identificacion });
    var sett = await setting.findOne({ user })
    if (usuario || sett) {
      sett.try = 0
      usuario.estado = true;
      sett.save();
      usuario.save();
      res.status(200).json({ message: "acualizado", });
    }
  } catch (error) {
    res.status(500).json({ "error": "no update", });
  }
}

const enviarContrasenaTemporal = async (req, res) => {
  const { identificacion } = req.body;
  var usuario = await Usuario.findOne({ identificacion });
  if (usuario) {
    if (usuario.estado == true) {
      let superoMaximoSolicitud = await verificarMaximoSolicitudRecuperarContraPorDia(identificacion);
      if (!superoMaximoSolicitud) {
        var codigo = generarCodigoAleatorio() + '';

        //este se guarda en check de usuario para calcular los 10 minutos de duración de la clave
        const token = await generarJWTRecuperacion(codigo, identificacion);

        // esta es la contraseña temporal
        let contrasenaEncry = bcrypt.hashSync(codigo, 10, function (err, hash) {
          if (err) {
            console.log(err);
          }
        });
        // actualizar en tabla usuarios(password, check, y role)
        usuario.password = contrasenaEncry;
        usuario.check = token;
        usuario.role = 'Role_User_Temp';
        await usuario.save();
        let cliente = await obtenerDatosCliente(identificacion);
        // enviar el correo con la contraseña temporal
        await enviarEmailContrasenaTemporal(cliente.email, cliente.nombres, codigo);
        await guardarSolicitudRecuperarContrasenia(identificacion);
        res.status(200).json({ "response": "Contraseña enviada correctamente" });
      } else {
        await bloquearUsuario(identificacion);
        res.status(400).json({ "error": "Superaste el número máximo de solicitudes de recuperación de contraseña, tu usuario ha sido bloqueado", });
      }
    } else {
      res.status(200).json({ "response": "El usuario esta bloqueado, acérquese a la agencia más cercana" });
    }
  } else {
    res.status(400).json({ "error": "No existe una cuenta creada en MiFuturo, ¡Crea una cuenta!", });
    return
  }
}


const bloquearUsuario = async (identificacion) => {
  var usuario = await Usuario.findOne({ identificacion });
  usuario.estado = false;
  usuario.save();
}

// codigo otp para validar antes de enviar la contraseña temporal al correo
const enviarSmsCodigoOtp = async (codigoOtp, identificacion) => {
  const args = {
    identificacion: identificacion,
    enviaSMS: true,
    enviaMail: false,
    codigootp: codigoOtp
  };
  soap.createClient(url, function (err, client) {
    if (err) {
      console.log(err)
      res.status(400).json({ "error ": err });
    } else {
      client.GeneraToken(args, async function (er, result) {
        if (er) {
          console.log(er)
        } else {
          return;
        }
      })
    }
  })
}



VerificarClientePorIdentificacion = async (req, res) => {
  const { identificacion } = req.body;
  console.log('III', identificacion)
  const user = await Usuario.findOne({ identificacion: identificacion });
  if (user) {
    res.status(400).json({ error: "Ya se encuentra registrado!" });
    return;
  } else {
    let cliente = await verificarSiTieneCuentasActivas(identificacion)
    if (cliente) {
      if (cliente.cantProductos > 0) {
        const token = await generarJWT('', false, identificacion);
        res.status(200).json({ "token": token, cliente: cliente.nombreUnido });
      } else {
        res.status(400).json({ error: "No tienes cuentas activas!" });
      }
    } else {
      return res.status(400).json({ error: "No existen tus datos!" });
    }
  }
}


const verificarContraseniaActual = async (req, res) => {
  const { claveactual } = req.body;
  const identificacion = req.user;
  const user = await Usuario.findOne({ identificacion: identificacion });
  if (!user) {
    res.status(400).json({ error: "Error no existe usuario" });
    return;
  } else {
    if (bcrypt.compareSync(claveactual, user.password)) {
      res.json({ "response": "Contraseña correcta" });
    } else {
      res.status(400).json({ "error": "Contraseña incorrecta!" });
    }
  }
}

const verificarSiClevesFueronUtilizadas = async (req, res) => {
  const identificacion = req.user;
  const { nuevaclave } = req.body;
  const user = await Usuario.findOne({ identificacion: identificacion });
  if (!user) {
    res.status(400).json({ error: "Error no existe usuario" });
    return;
  } else {
    const datos = await Dato.find({ cliente: user._id });
    if (datos) {
      let claveAntiguaEncontrada = false;
      if (datos.length > 0) {
        for (let i = 0; i < datos.length; i++) {
          if (bcrypt.compareSync(nuevaclave, datos[i].dato)) {
            claveAntiguaEncontrada = true;
          }
        }
      }
      if (claveAntiguaEncontrada == true) {
        res.status(400).json({ "error": "La Contraseña ya fue utilizada anteriormente!" });
        return;
      }
    }
  }
  res.json({ "response": "Contraseña es nueva" });
}


const cambiarContrasena = async (req, res) => {
  const { codigootp, nuevaclave } = req.body;
  const identificacion = req.user;
  const solicitudotp = await Solicitudotp.findOne({ identificacion: identificacion, esvalidado: false }).sort({ $natural: -1 }).limit(1);
  if (solicitudotp) {
    if (!bcrypt.compareSync(codigootp, solicitudotp.tokens)) {
      res.status(400).json({ "error": "Código OTP Inválido" });
    } else {
      // cambiar el estado del otp
      solicitudotp.esvalidado = true;
      solicitudotp.save(async (error, countBD) => {
        if (error) {
          console.log(error);
          res.status(500).json({ "error": error });
          return;
        }
      });

      let contrasenaNuevaEncry = bcrypt.hashSync(nuevaclave, 10, function (err, hash) {
        if (err) {
          console.log(err);
        }
      });
      const user = await Usuario.findOne({ identificacion: identificacion });
      if (!user) {
        res.status(400).json({ error: "Error no existe usuario" });
        return;
      } else {
        let dato = new Dato({
          dato: contrasenaNuevaEncry,
          fecha: new Date(),
          cliente: user._id,
        });
        await dato.save();
        user.password = contrasenaNuevaEncry;
        user.check = null;
        await user.save();
        res.status(200).json({ "response": "Contraseña actualizada correctamente" });
        return;
      }
    }
  } else {
    res.status(400).json({ error: "No existe código otp enviado!" });
    return;
  }
}



/*
 **************************
 **** Asignar Password ****
 **************************
 */

const guardarHistorialContrasenas = async (contrasena, iduser) => {
  if (contrasena != null || contrasena != "") {
    let dato = new Dato({
      dato: contrasena,
      fecha: new Date(),
      cliente: iduser,
    });
    dato.save();
  }
}

const passwordValidate = (req, res) => {
  const { password } = req.body;
  const { _id } = req.uid;
  Usuario.findOne({ _id }, function (err, usr) {
    if (err) {
      return res.status(400).json({
        ok: false,
        message: "Error al identificar",
      });
    }
    if (usr) {
      if (bcrypt.compareSync(password, usr.password)) {
        return res.status(200).json({
          ok: true,
        });
      } else {
        return res.status(200).json({
          ok: false,
        });
      }
    }
  });
};

const verificarSiExisteNick = async (req, res) => {
  const { nick } = req.body;
  const usernick = await Usuario.findOne({ nick });
  if (usernick) {
    res.status(400).json({ "error": "Ya existe el nombre de usuario, intente ingresando un nombre diferente!" });
  } else {
    res.status(200).json({ "response": "ok" });
  }
};

const RegistroUsuarioConOTP = async (req, res) => {
  const { codigootp, nick, password } = req.body;
  const identificacion = req.user;

  const solicitudotp = await Solicitudotp.findOne({ identificacion: identificacion, esvalidado: false }).sort({ $natural: -1 }).limit(1);
  if (!bcrypt.compareSync(codigootp, solicitudotp.tokens)) {
    res.status(400).json({ "error": "Código OTP Inválido" });
    return;
  } else {
    // cambiar el estado del otp
    solicitudotp.esvalidado = true;
    await solicitudotp.save();

    // verificar si ya se encuentra registrado
    const user = await Usuario.findOne({ identificacion: identificacion });
    if (user) {
      res.status(400).json({ error: "Ya existe usuario" });
      return;
    } else {
      // verificar si numero de cliente ya se encuentra registrado
      const usernick = await Usuario.findOne({ nick });
      if (usernick) {
        res.status(400).json({ error: "Ya existe el nick" });
        return;
      } else {
        let cliente = await verificarSiTieneCuentasActivas(identificacion);
        if (cliente.cantProductos == 0) {
          res.status(400).json({ error: "No tienes cuentas activas!" });
          return;
        } else {
          // Proceso de registro
          try {
            let contrasenaEncry = bcrypt.hashSync(password, 10, function (err, hash) {
              if (err) {
                console.log(err);
              }
            });
            let cliente = await obtenerDatosCliente(identificacion);
            // verificar el email
            const emailUser = await Usuario.findOne({ email: cliente.email })
            if (emailUser) {
              res.status(400).json({ error: "El correo electrónico ya se encuentra registrado en otra cuenta. Actualiza tu correo electrónico" });
              return;
            }
            let iduser = await guardarUsuario(cliente.nombres, cliente.email, nick, contrasenaEncry, cliente.fechaNacimiento, identificacion, cliente.oficina, cliente.tipoidentificacion, cliente.numeroCliente, "true");
            console.log(iduser);
            await guardarHistorialContrasenas(contrasenaEncry)
            const token = await generarJWT(iduser, false, identificacion);
            await guardarSettings(iduser);
            let esSocio = await verificarSiEsSocio(identificacion);
            res.json({ "response": "Registro exitoso!", "token": token, "user": { "nombre": cliente.nombres, "nick": nick, "img": "/user/unknown-profile.jpg", "oficina": cliente.oficina, "role": "Role_User", "cedula": identificacion, "essocio": esSocio } });
            return;
          } catch (error) {
            console.log(error);
            res.status(400).json({ error: error });
            return;
          }
        }
      }
    }
  }
};

guardarUsuario = async (nombres, email, nick, password, fechanacimiento, identificacion, oficina, tipoidentificacion, numerocliente, ckeck) => {
  let usuario = new Usuario({
    nombre: nombres,
    email: email,
    nick: nick,
    password: password,
    img: "/user/unknown-profile.jpg",
    constitucion: fechanacimiento,
    estado: 1,
    identificacion: identificacion,
    oficina: oficina,
    Tidentificacion: tipoidentificacion,
    numerocliente: numerocliente,
    role: "Role_User",
    check: ckeck,
    Date: Date.now(),
    add: Date.now(),
    update: "",
  });
  await usuario.save(async (er, userDB) => {
    if (er) {
      console.log(er);
      throw er
    }
    console.log(userDB)
  });

  return usuario._id;
}

guardarSettings = async (idusuario) => {
  let dia = new Date();
  let configuracion = new setting({
    try: 0,
    accept: true,
    amount: 5000,
    amount_out: 0,
    transfer: 0,
    months: 3,
    date: dia.getDate(),
    user: idusuario,
  });
  await configuracion.save(async (er, userDB) => {
    if (er) {
      throw er
    } else {
      return "Settings creado!";
    }
  });
}



const generarCodigoOTP = async (req, res) => {
  const identificacion = req.user;
  console.log('eeee',identificacion)
  var codigoOtp = generarCodigoAleatorio() + '';
  console.log(codigoOtp)

  const args = {
    identificacion: identificacion,
    enviaSMS: true,
    enviaMail: true,
    codigootp: codigoOtp
  };


  // encripta el codigo otp
  var token = bcrypt.hashSync(codigoOtp, 10,
    function (err, hash) {
      if (err) {
        console.log("Es Aqui 1")
        console.log(err)
        res.status(500).json({ "error": err });
      }
    }
  );

  let solicitudotp = new Solicitudotp({
    identificacion: identificacion,
    tokens: token,
    esvalidado: false,
    transaccion: 'OTP'
  });
  await solicitudotp.save(async (er, userDB) => {
    if (er) {
      throw er
    }
  });
  soap.createClient(url, function (err, client) {
    if (err) {
      console.log(err)
      res.status(400).json({ "error ": err });
    } else {
      client.GeneraToken(args, async function (er, result) {
        if (er) {
          console.log(er)
          res.status(400).json({ "datos": er });
        } else {
          console.log('BIEN')
          //var codigoOTP = result.GeneraTokenResult.Token;
          res.status(200).json({ "response": "Código OTP enviado" });
          return;
        }
      })
    }
  })
}




function generarCodigoAleatorio() {
  let min = 100000;
  let max = 999999;
  return Math.floor((Math.random() * (max - min + 1)) + min);
}


/********New Checker********/
const renewcheck = async (req, res) => {
  const { identificacion, numerocliente } = req.uid;
  var codigoOtp = generarCodigoAleatorio() + '';
  const args = {
    identificacion,
    numeroCliente: numerocliente,
    enviaSMS: true,
    enviaMail: false,
    codigootp: codigoOtp
  };
  console.log(args);
  soap.createClient(url, function (err, client) {
    if (err) {
      console.log(err);
      return res.status(400).json({
        ok: false,
        opt: "check",
        err,
      });
    } else {
      client.GeneraToken(args, function (er, result) {
        console.log(result)
        if (er) {
          console.log("Error al retornar datos del servicio 0001: " + er);
          return res.status(400).json({
            ok: false,
            opt: "datos",
            er,
          });
        } else {
          Usuario.findOne({ identificacion }, function (er, usuario) {
            console.log("--------");
            console.log(result.GeneraTokenResult.Token);
            usuario.check = bcrypt.hashSync(
              result.GeneraTokenResult.Token,
              10,
              function (err, hash) {
                console.log("encrypt");
                if (err) {
                  console.log(err);
                  return res.status(500).json({
                    ok: false,
                    err,
                  });
                }
              }
            );
            usuario.Date = new Date();
            usuario.save(async (er, userDB) => {
              if (er) {
                return res.status(400).json({
                  ok: false,
                  er,
                });
              } else {
                let msg = "";
                if (args.enviaMail) {
                  msg = "Código enviado al Email";
                } else {
                  msg = "Código enviado al número registrado";
                }
                return res.json({
                  ok: true,
                  message: msg,
                  token: result.GeneraTokenResult.Token,
                });
              }
            });
          });
        }
      });
    }
  });
};

module.exports = {
  renewcheck,
  passwordValidate,
  VerificarClientePorIdentificacion,
  generarCodigoOTP,
  RegistroUsuarioConOTP,
  cambiarContrasena,
  verificarContraseniaActual,
  verificarSiClevesFueronUtilizadas,
  verificarSiExisteNick,
  enviarContrasenaTemporal,
  nuevasContrasena,
  verificaCheckTemporal,
  enviarCodigoOTPRecuperarUsuario,
  enviarUsuarioRecuperarPorEmail,
  enviarCodigoOTPDesbloquearCuenta,
  verificaCodigo,
  cambiarEstado,
  updateUsuario,
  enviarUsuarioCliente
};
