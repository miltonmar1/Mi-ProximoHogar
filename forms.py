"""Formularios WTForms."""
from flask_wtf import FlaskForm
from wtforms import (
    BooleanField, DecimalField, IntegerField, PasswordField, SelectField,
    StringField, SubmitField, TextAreaField,
)
from wtforms.validators import DataRequired, Email, EqualTo, Length, NumberRange, Optional, ValidationError


def _acepta_terminos_obligatorio(form, field):
    if not field.data:
        raise ValidationError("Debes aceptar los terminos y la politica de privacidad.")


def _empty_to_none(value):
    if value is None or value == "":
        return None
    return value


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=200)])
    password = PasswordField("Contrasena", validators=[DataRequired(), Length(min=6, max=200)])
    recordar = BooleanField("Recordarme")
    submit = SubmitField("Ingresar")


class RecuperarPasswordForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=200)])
    submit = SubmitField("Enviar enlace de recuperacion")


class RestablecerPasswordForm(FlaskForm):
    password = PasswordField("Nueva contrasena", validators=[DataRequired(), Length(min=6, max=200)])
    confirmar = PasswordField(
        "Confirmar contrasena",
        validators=[DataRequired(), EqualTo("password", message="Las contrasenas no coinciden")],
    )
    submit = SubmitField("Guardar nueva contrasena")


class GoogleTermsForm(FlaskForm):
    acepta_terminos = BooleanField(
        "Acepto los terminos y la politica de privacidad",
        validators=[_acepta_terminos_obligatorio],
    )
    submit = SubmitField("Completar registro con Google")


class RegisterForm(FlaskForm):
    nombre = StringField("Nombre completo", validators=[DataRequired(), Length(max=120)])
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=200)])
    telefono = StringField("Telefono", validators=[Optional(), Length(max=30)])
    password = PasswordField("Contrasena", validators=[DataRequired(), Length(min=6, max=200)])
    confirmar = PasswordField(
        "Confirmar contrasena",
        validators=[DataRequired(), EqualTo("password", message="Las contrasenas no coinciden")],
    )
    es_agente = BooleanField("Soy agente / agencia inmobiliaria")
    acepta_terminos = BooleanField(
        "Acepto los terminos y la politica de privacidad",
        validators=[_acepta_terminos_obligatorio],
    )
    submit = SubmitField("Crear cuenta")


class PropiedadForm(FlaskForm):
    titulo = StringField("Titulo", validators=[DataRequired(), Length(max=200)])
    descripcion = TextAreaField("Descripcion", validators=[Optional(), Length(max=4000)])
    operacion = SelectField(
        "Operacion",
        choices=[("venta", "Venta"), ("alquiler", "Alquiler")],
        validators=[DataRequired()],
    )
    tipo_id = SelectField("Tipo de propiedad", coerce=int, validators=[DataRequired()])
    ciudad_id = SelectField("Ciudad", coerce=int, validators=[DataRequired()])
    distrito = StringField("Distrito / zona", validators=[Optional(), Length(max=120)])
    direccion = StringField("Direccion", validators=[Optional(), Length(max=250)])
    precio = DecimalField("Precio", validators=[DataRequired(), NumberRange(min=0)])
    moneda = SelectField("Moneda", choices=[("PEN", "S/ Soles"), ("USD", "US$ Dolares")], default="PEN")
    area_total = DecimalField(
        "Area total (m2)",
        validators=[Optional(), NumberRange(min=0)],
        filters=[_empty_to_none],
    )
    area_construida = DecimalField(
        "Area construida (m2)",
        validators=[Optional(), NumberRange(min=0)],
        filters=[_empty_to_none],
    )
    habitaciones = IntegerField(
        "Habitaciones",
        validators=[Optional(), NumberRange(min=0, max=50)],
        filters=[_empty_to_none],
    )
    banos = IntegerField(
        "Banos",
        validators=[Optional(), NumberRange(min=0, max=50)],
        filters=[_empty_to_none],
    )
    cocheras = IntegerField(
        "Cocheras",
        validators=[Optional(), NumberRange(min=0, max=20)],
        filters=[_empty_to_none],
    )
    imagen_url = StringField("URL de imagen principal (opcional)", validators=[Optional(), Length(max=400)])
    video_urls = TextAreaField(
        "URLs de video (opcional)",
        validators=[Optional(), Length(max=3000)],
        description="YouTube, TikTok o Facebook — una URL por linea.",
    )
    submit = SubmitField("Publicar")


class ContactoForm(FlaskForm):
    nombre = StringField("Tu nombre", validators=[DataRequired(), Length(max=120)])
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=200)])
    telefono = StringField("Telefono", validators=[Optional(), Length(max=30)])
    mensaje = TextAreaField("Mensaje", validators=[DataRequired(), Length(min=10, max=2000)])
    submit = SubmitField("Enviar mensaje")


class PerfilForm(FlaskForm):
    nombre = StringField("Nombre completo", validators=[DataRequired(), Length(max=120)])
    telefono = StringField("Telefono", validators=[Optional(), Length(max=30)])
    biografia = TextAreaField("Biografia / presentacion", validators=[Optional(), Length(max=800)])
    foto_url = StringField("URL de foto de perfil (opcional)", validators=[Optional(), Length(max=400)])
    es_agente = BooleanField("Soy agente / agencia inmobiliaria")
    submit = SubmitField("Guardar cambios")
